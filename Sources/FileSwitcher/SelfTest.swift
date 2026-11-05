import Foundation
import Security

/// Самопроверка: `FileSwitcher --selftest`. Проверяет то, чего не видит `swift test`, -
/// материал CA на диске, выпуск сертификата и его цепочку до этого CA.
enum SelfTest {
    /// Итог одной проверки
    enum Outcome: Equatable {
        case pass
        case warn(String)
        case fail(String)
    }

    /// Печатает отчёт и выходит с кодом 1 при отказе основной возможности
    static func runAndExit() -> Never {
        var failed = false
        for (name, outcome) in run() {
            switch outcome {
            case .pass:
                print("PASS \(name)")
            case let .warn(detail):
                print("WARN \(name): \(detail)")
            case let .fail(detail):
                print("FAIL \(name): \(detail)")
                failed = true
            }
        }
        print(failed ? "selftest: FAILED" : "selftest: OK")
        exit(failed ? 1 : 0)
    }

    /// Набор проверок этапа 1
    static func run() -> [(String, Outcome)] {
        var results: [(String, Outcome)] = []
        results.append(("CA на диске", caOnDisk()))

        var authority: CertificateAuthority?
        do {
            authority = try CertificateAuthority()
            results.append(("загрузка CA", .pass))
        } catch {
            results.append(("загрузка CA", .fail(error.localizedDescription)))
        }

        if let authority {
            results.append(("выпуск сертификата", issuance(authority)))
            results.append(("цепочка до CA", chain(authority)))
            results.append(("TLS-контекст хоста", tlsContext(authority)))
        }
        return results
    }

    /// Сообщение об ошибке в stderr
    static func writeError(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }

    private static func caOnDisk() -> Outcome {
        let path = CertificateAuthority.keyAndCertificatePath.path
        guard FileManager.default.fileExists(atPath: path) else {
            return .fail("нет \(path)")
        }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
              let permissions = attributes[.posixPermissions] as? NSNumber else {
            return .warn("права на \(path) не читаются")
        }
        return permissions.intValue == 0o600 ? .pass : .warn("права \(String(permissions.intValue, radix: 8)) вместо 600")
    }

    private static func issuance(_ authority: CertificateAuthority) -> Outcome {
        do {
            let der = try authority.certificateDER(forHost: "example.com")
            return der.isEmpty ? .fail("пустой сертификат") : .pass
        } catch {
            return .fail(error.localizedDescription)
        }
    }

    private static func chain(_ authority: CertificateAuthority) -> Outcome {
        do {
            let leafDER = try authority.certificateDER(forHost: "example.com")
            let material = try CertificateAuthority.loadMaterial()
            guard let leaf = SecCertificateCreateWithData(nil, Data(leafDER) as CFData),
                  let ca = SecCertificateCreateWithData(nil, Data(material.certificateDER) as CFData) else {
                return .fail("сертификаты не разбираются системой")
            }
            var trust: SecTrust?
            let status = SecTrustCreateWithCertificates(
                [leaf] as CFArray,
                SecPolicyCreateSSL(true, "example.com" as CFString),
                &trust
            )
            guard status == errSecSuccess, let trust else { return .fail("доверие не создано") }
            SecTrustSetAnchorCertificates(trust, [ca] as CFArray)
            SecTrustSetAnchorCertificatesOnly(trust, true)
            var error: CFError?
            let trusted = SecTrustEvaluateWithError(trust, &error)
            return trusted ? .pass : .fail((error as Error?)?.localizedDescription ?? "цепочка не проходит")
        } catch {
            return .fail(error.localizedDescription)
        }
    }

    private static func tlsContext(_ authority: CertificateAuthority) -> Outcome {
        do {
            _ = try authority.context(forHost: "example.com")
            return .pass
        } catch {
            return .fail(error.localizedDescription)
        }
    }
}
