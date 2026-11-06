import CryptoKit
import Foundation
import Network
import NIOSSL
import Security

/// Ошибки выпуска сертификатов: сообщения показываются в UI и в самопроверке
enum CertificateAuthorityError: LocalizedError {
    /// Не удалось создать или прочитать ключ
    case keyUnavailable(String)
    /// Не удалось собрать или подписать сертификат
    case certificateUnavailable(String)
    /// В файле CA нет ключа или сертификата
    case missingMaterial(String)

    var errorDescription: String? {
        switch self {
        case let .keyUnavailable(detail):
            return "Ключ недоступен: \(detail)"
        case let .certificateUnavailable(detail):
            return "Сертификат не выпущен: \(detail)"
        case let .missingMaterial(detail):
            return "Нет материала CA: \(detail)"
        }
    }
}

/// CA из `~/.mitmproxy` и выпуск листовых сертификатов под перехватываемые хосты.
/// Один ключ на все хосты, как у mitmproxy: RSA-ключ генерируется долго, подпись сертификата - нет.
/// `@unchecked Sendable`: материал неизменяем, кэш контекстов под замком.
final class CertificateAuthority: @unchecked Sendable {
    /// Каталог mitmproxy: тот же CA, которому система уже доверяет, продолжает работать
    static let directory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".mitmproxy", isDirectory: true)
    /// Ключ и сертификат CA в одном PEM
    static let keyAndCertificatePath = directory.appendingPathComponent("mitmproxy-ca.pem")
    /// Только сертификат CA: его добавляют в доверенные
    static let certificatePath = directory.appendingPathComponent("mitmproxy-ca-cert.pem")

    private static let caValidityYears = 10
    private static let leafValidityDays = 365
    private static let maxCachedContexts = 1_000

    /// Ключ CA: им подписываются листовые сертификаты
    private let signingKey: SecKey
    /// Subject CA байтами: issuer листового сертификата должен совпадать с ним побайтово
    private let issuerDER: [UInt8]
    /// Один ключ на все листовые сертификаты
    private let leafKey: SecKey
    private let leafPublicKeyDER: [UInt8]
    private let leafKeyPKCS8: [UInt8]
    private var contexts: [String: NIOSSLContext] = [:]
    /// Клиентский контекст общий: создавать его на каждое соединение слишком дорого
    private var clientContext: NIOSSLContext?
    private let lock = NSLock()

    init() throws {
        let material = try Self.loadMaterial()
        signingKey = material.key
        issuerDER = material.subjectDER
        let leaf = try Self.makeLeafKey()
        leafKey = leaf.key
        leafPublicKeyDER = leaf.publicKeyDER
        leafKeyPKCS8 = leaf.pkcs8
    }
}

// MARK: - Материал CA

extension CertificateAuthority {
    /// Читает ключ и сертификат CA, создавая их при первом запуске
    static func loadMaterial() throws -> (key: SecKey, certificateDER: [UInt8], subjectDER: [UInt8]) {
        try ensureCAExists()
        guard let pem = try? String(contentsOf: keyAndCertificatePath, encoding: .utf8) else {
            throw CertificateAuthorityError.missingMaterial(keyAndCertificatePath.path)
        }
        guard let keyDER = pemBlock(in: pem, labels: ["RSA PRIVATE KEY", "PRIVATE KEY"]),
              let certificateDER = pemBlock(in: pem, labels: ["CERTIFICATE"]) else {
            throw CertificateAuthorityError.missingMaterial("\(keyAndCertificatePath.path): нет ключа или сертификата")
        }
        guard let subject = DerReader.subjectDER(inCertificate: certificateDER) else {
            throw CertificateAuthorityError.certificateUnavailable("не разобран subject CA")
        }
        return (try privateKey(fromDER: keyDER), certificateDER, subject)
    }

    /// Создаёт CA и кладёт его в `~/.mitmproxy`, если там ещё ничего нет
    static func ensureCAExists() throws {
        guard !FileManager.default.fileExists(atPath: keyAndCertificatePath.path) else { return }

        let created = try makeLeafKey()
        let publicKeyDER = created.publicKeyDER
        let pkcs8 = created.pkcs8
        let key = created.key
        let subject = distinguishedName(commonName: "FileSwitcher CA", organization: "FileSwitcher")
        let now = Date()
        let notAfter = Calendar(identifier: .gregorian).date(byAdding: .year, value: caValidityYears, to: now) ?? now
        let extensions = [
            extensionValue("2.5.29.19", critical: true, value: Der.sequence(Der.boolean(true))),
            extensionValue("2.5.29.15", critical: true, value: Der.bitString([0x06], unusedBits: 1)),
            extensionValue("2.5.29.14", critical: false,
                           value: Der.octetString(Insecure.SHA1.hash(data: publicKeyDER).map { $0 }))
        ]
        let certificateDER = try buildCertificate(
            subject: subject,
            issuer: subject,
            publicKeyDER: publicKeyDER,
            serial: randomSerial(),
            notBefore: now.addingTimeInterval(-24 * 60 * 60),
            notAfter: notAfter,
            extensions: extensions,
            signingKey: key
        )
        let keyPEM = pem(pkcs8, label: "PRIVATE KEY")
        let certificatePEM = pem(certificateDER, label: "CERTIFICATE")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try keyPEM.write(to: keyAndCertificatePath, atomically: true, encoding: .utf8)
        try certificatePEM.write(to: certificatePath, atomically: true, encoding: .utf8)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: keyAndCertificatePath.path)
    }
}

// MARK: - Выпуск сертификатов

extension CertificateAuthority {
    /// TLS-контекст с сертификатом хоста (кэшируется по имени)
    func context(forHost host: String) throws -> NIOSSLContext {
        lock.lock()
        let cached = contexts[host]
        lock.unlock()
        if let cached {
            return cached
        }

        let certificate = try NIOSSLCertificate(bytes: certificateDER(forHost: host), format: .der)
        let key = try NIOSSLPrivateKey(bytes: leafKeyPKCS8, format: .der)
        var configuration = TLSConfiguration.makeServerConfiguration(
            certificateChain: [.certificate(certificate)],
            privateKey: .privateKey(key)
        )
        // сертификат выпущен нами, проверять клиентские сертификаты не нужно
        configuration.certificateVerification = .none
        // HTTP/2 не перехватываем: клиенту предлагается только http/1.1
        configuration.applicationProtocols = ["http/1.1"]
        let context = try NIOSSLContext(configuration: configuration)

        lock.lock()
        if contexts.count >= Self.maxCachedContexts {
            contexts.removeAll()
        }
        contexts[host] = context
        lock.unlock()
        return context
    }

    /// Клиентский TLS-контекст для соединений с настоящими серверами: создаётся один раз на запуск
    func clientTLSContext() throws -> NIOSSLContext {
        lock.lock()
        let cached = clientContext
        lock.unlock()
        if let cached {
            return cached
        }
        let context = try NIOSSLContext(configuration: TLSConfiguration.makeClientConfiguration())
        lock.lock()
        clientContext = context
        lock.unlock()
        return context
    }

    /// DER сертификата для хоста
    func certificateDER(forHost host: String) throws -> [UInt8] {
        let now = Date()
        let extensions = [
            Self.extensionValue("2.5.29.19", critical: false, value: Der.sequence()),
            // digitalSignature + keyEncipherment
            Self.extensionValue("2.5.29.15", critical: true, value: Der.bitString([0xa0], unusedBits: 5)),
            // serverAuth
            Self.extensionValue("2.5.29.37", critical: false, value: Der.sequence(Der.oid("1.3.6.1.5.5.7.3.1"))),
            Self.extensionValue("2.5.29.17", critical: false, value: Self.subjectAltName(host))
        ]
        return try Self.buildCertificate(
            subject: Self.distinguishedName(commonName: host),
            issuer: issuerDER,
            publicKeyDER: leafPublicKeyDER,
            serial: Self.randomSerial(),
            notBefore: now.addingTimeInterval(-24 * 60 * 60),
            notAfter: now.addingTimeInterval(TimeInterval(Self.leafValidityDays * 24 * 60 * 60)),
            extensions: extensions,
            signingKey: signingKey
        )
    }

    /// PEM сертификата хоста
    func certificatePEM(forHost host: String) throws -> String {
        Self.pem(try certificateDER(forHost: host), label: "CERTIFICATE")
    }
}

// MARK: - Сборка сертификата

extension CertificateAuthority {
    /// Собирает DER сертификата X.509 и подписывает его ключом
    static func buildCertificate(
        subject: [UInt8],
        issuer: [UInt8],
        publicKeyDER: [UInt8],
        serial: [UInt8],
        notBefore: Date,
        notAfter: Date,
        extensions: [[UInt8]],
        signingKey: SecKey
    ) throws -> [UInt8] {
        // sha256WithRSAEncryption
        let signatureAlgorithm = Der.sequence(Der.oid("1.2.840.113549.1.1.11"), Der.null())
        // rsaEncryption + BIT STRING с ключом PKCS#1
        let subjectPublicKeyInfo = Der.sequence(
            Der.sequence(Der.oid("1.2.840.113549.1.1.1"), Der.null()),
            Der.bitString(publicKeyDER)
        )
        var fields: [[UInt8]] = [
            Der.contextTag(0, Der.integer(2)),
            Der.integer(serial),
            signatureAlgorithm,
            issuer,
            Der.sequence(Der.utcTime(notBefore), Der.utcTime(notAfter)),
            subject,
            subjectPublicKeyInfo
        ]
        if !extensions.isEmpty {
            fields.append(Der.contextTag(3, Der.tlv(0x30, extensions.flatMap { $0 })))
        }
        let tbs = Der.tlv(0x30, fields.flatMap { $0 })

        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            signingKey,
            .rsaSignatureMessagePKCS1v15SHA256,
            Data(tbs) as CFData,
            &error
        ) as Data? else {
            let detail = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "подпись не создана"
            throw CertificateAuthorityError.certificateUnavailable(detail)
        }
        return Der.sequence(tbs, signatureAlgorithm, Der.bitString([UInt8](signature)))
    }

    /// Расширение сертификата по RFC 5280
    static func extensionValue(_ oid: String, critical: Bool, value: [UInt8]) -> [UInt8] {
        var parts: [[UInt8]] = [Der.oid(oid)]
        if critical {
            parts.append(Der.boolean(true))
        }
        parts.append(Der.octetString(value))
        return Der.tlv(0x30, parts.flatMap { $0 })
    }

    /// Subject с общим именем (и организацией, если задана)
    static func distinguishedName(commonName: String, organization: String? = nil) -> [UInt8] {
        var attributes = [Der.set(Der.sequence(Der.oid("2.5.4.3"), Der.utf8String(commonName)))]
        if let organization {
            attributes.append(Der.set(Der.sequence(Der.oid("2.5.4.10"), Der.utf8String(organization))))
        }
        return Der.tlv(0x30, attributes.flatMap { $0 })
    }

    /// Альтернативные имена: IP кодируется октетами, домен - строкой IA5
    static func subjectAltName(_ host: String) -> [UInt8] {
        if let address = IPv4Address(host) {
            return Der.sequence(Der.contextTag(7, [UInt8](address.rawValue), constructed: false))
        }
        if let address = IPv6Address(host) {
            return Der.sequence(Der.contextTag(7, [UInt8](address.rawValue), constructed: false))
        }
        return Der.sequence(Der.contextTag(2, Array(host.utf8), constructed: false))
    }
}

// MARK: - Ключи и PEM

extension CertificateAuthority {
    /// Создаёт RSA-2048 ключ: сам ключ, открытый ключ и PKCS#8-представление для NIOSSL
    static func makeLeafKey() throws -> (key: SecKey, publicKeyDER: [UInt8], pkcs8: [UInt8]) {
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits: 2048,
            kSecAttrIsPermanent: false
        ]
        var error: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            let detail = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "не создан"
            throw CertificateAuthorityError.keyUnavailable(detail)
        }
        guard let publicKey = SecKeyCopyPublicKey(key),
              let publicKeyDER = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            throw CertificateAuthorityError.keyUnavailable("нет внешнего представления открытого ключа")
        }
        guard let privateKeyDER = SecKeyCopyExternalRepresentation(key, nil) as Data? else {
            throw CertificateAuthorityError.keyUnavailable("нет внешнего представления закрытого ключа")
        }
        return (key, [UInt8](publicKeyDER), pkcs8([UInt8](privateKeyDER)))
    }

    /// SecKey из DER: принимает PKCS#1 и PKCS#8
    static func privateKey(fromDER der: [UInt8]) throws -> SecKey {
        let attributes: [CFString: Any] = [
            kSecAttrKeyType: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass: kSecAttrKeyClassPrivate
        ]
        var error: Unmanaged<CFError>?
        if let key = SecKeyCreateWithData(Data(der) as CFData, attributes as CFDictionary, &error) {
            return key
        }
        // PKCS#8 завёрнут в PrivateKeyInfo - достаём из него PKCS#1 и пробуем снова
        if let inner = pkcs1(fromPKCS8: der),
           let key = SecKeyCreateWithData(Data(inner) as CFData, attributes as CFDictionary, &error) {
            return key
        }
        let detail = (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "не разобран DER ключа"
        throw CertificateAuthorityError.keyUnavailable(detail)
    }

    /// Оборачивает PKCS#1 в PrivateKeyInfo (PKCS#8)
    static func pkcs8(_ pkcs1DER: [UInt8]) -> [UInt8] {
        Der.sequence(
            Der.integer(0),
            Der.sequence(Der.oid("1.2.840.113549.1.1.1"), Der.null()),
            Der.octetString(pkcs1DER)
        )
    }

    /// Достаёт PKCS#1 из PrivateKeyInfo (PKCS#8)
    static func pkcs1(fromPKCS8 der: [UInt8]) -> [UInt8]? {
        guard let info = DerReader.elements(in: der, range: 0..<der.count).first, info.tag == 0x30 else {
            return nil
        }
        let fields = DerReader.elements(in: der, range: info.contentStart..<info.end)
        guard fields.count >= 3, fields[2].tag == 0x04 else { return nil }
        return DerReader.content(of: fields[2], in: der)
    }

    /// Случайный положительный серийный номер
    static func randomSerial() -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        bytes[0] &= 0x7f
        return bytes
    }

    /// PEM-обёртка DER с переносом строк по 64 символа
    static func pem(_ der: [UInt8], label: String) -> String {
        let base64 = Data(der).base64EncodedString()
        var lines: [String] = []
        var index = base64.startIndex
        while index < base64.endIndex {
            let next = base64.index(index, offsetBy: 64, limitedBy: base64.endIndex) ?? base64.endIndex
            lines.append(String(base64[index..<next]))
            index = next
        }
        return "-----BEGIN \(label)-----\n" + lines.joined(separator: "\n") + "\n-----END \(label)-----\n"
    }

    /// DER из первого PEM-блока с одним из заголовков
    static func pemBlock(in text: String, labels: [String]) -> [UInt8]? {
        for label in labels {
            let begin = "-----BEGIN \(label)-----"
            let end = "-----END \(label)-----"
            guard let beginRange = text.range(of: begin),
                  let endRange = text.range(of: end, range: beginRange.upperBound..<text.endIndex) else {
                continue
            }
            let body = text[beginRange.upperBound..<endRange.lowerBound]
                .components(separatedBy: .whitespacesAndNewlines)
                .joined()
            if let data = Data(base64Encoded: body) {
                return [UInt8](data)
            }
        }
        return nil
    }
}
