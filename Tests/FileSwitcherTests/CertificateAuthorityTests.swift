import Foundation
import NIOSSL
import Security
import Testing

@testable import FileSwitcher

struct CertificateAuthorityTests {
    @Test
    func caLivesWhereMitmproxyKeptIt() {
        #expect(CertificateAuthority.keyAndCertificatePath.path.hasSuffix("/.mitmproxy/mitmproxy-ca.pem"))
        #expect(CertificateAuthority.certificatePath.path.hasSuffix("/.mitmproxy/mitmproxy-ca-cert.pem"))
    }

    @Test
    func pkcs8RoundTripKeepsPKCS1() throws {
        let inner = Array("не-der, но байты".utf8)
        let wrapped = CertificateAuthority.pkcs8(inner)
        #expect(CertificateAuthority.pkcs1(fromPKCS8: wrapped) == inner)
    }

    @Test
    func pemRoundTripKeepsDER() {
        let der = [UInt8](repeating: 0xab, count: 200)
        let text = CertificateAuthority.pem(der, label: "CERTIFICATE")
        #expect(text.hasPrefix("-----BEGIN CERTIFICATE-----\n"))
        #expect(CertificateAuthority.pemBlock(in: text, labels: ["CERTIFICATE"]) == der)
        #expect(CertificateAuthority.pemBlock(in: text, labels: ["PRIVATE KEY"]) == nil)
    }

    @Test
    func serialIsPositiveAndSixteenBytes() {
        let serial = CertificateAuthority.randomSerial()
        #expect(serial.count == 16)
        #expect(serial[0] & 0x80 == 0)
    }

    @Test
    func domainNameGoesToSANAsIA5String() {
        let san = CertificateAuthority.subjectAltName("example.com")
        // SEQUENCE -> [2] IMPLICIT IA5String "example.com"
        #expect(san == Der.sequence(Der.contextTag(2, Array("example.com".utf8), constructed: false)))
    }

    @Test
    func ipAddressGoesToSANAsOctets() {
        let san = CertificateAuthority.subjectAltName("127.0.0.1")
        #expect(san == Der.sequence(Der.contextTag(7, [127, 0, 0, 1], constructed: false)))
        let v6 = CertificateAuthority.subjectAltName("::1")
        #expect(v6 == Der.sequence(Der.contextTag(7, [UInt8](repeating: 0, count: 15) + [1], constructed: false)))
    }

    @Test
    func issuedCertificateChainsToCa() throws {
        let authority = try CertificateAuthority()
        let leafDER = try authority.certificateDER(forHost: "example.com")
        let material = try CertificateAuthority.loadMaterial()
        let leaf = try #require(SecCertificateCreateWithData(nil, Data(leafDER) as CFData))
        let ca = try #require(SecCertificateCreateWithData(nil, Data(material.certificateDER) as CFData))

        let trust = try #require(makeTrust(leaf: leaf, anchor: ca, host: "example.com"))
        var error: CFError?
        #expect(SecTrustEvaluateWithError(trust, &error), "\(String(describing: error))")
    }

    @Test
    func issuedCertificateIsRejectedForAnotherHost() throws {
        let authority = try CertificateAuthority()
        let leafDER = try authority.certificateDER(forHost: "example.com")
        let material = try CertificateAuthority.loadMaterial()
        let leaf = try #require(SecCertificateCreateWithData(nil, Data(leafDER) as CFData))
        let ca = try #require(SecCertificateCreateWithData(nil, Data(material.certificateDER) as CFData))

        let trust = try #require(makeTrust(leaf: leaf, anchor: ca, host: "other.example"))
        #expect(!SecTrustEvaluateWithError(trust, nil))
    }

    @Test
    func issuedCertificateCoversLoopbackAddress() throws {
        let authority = try CertificateAuthority()
        let leafDER = try authority.certificateDER(forHost: "127.0.0.1")
        let material = try CertificateAuthority.loadMaterial()
        let leaf = try #require(SecCertificateCreateWithData(nil, Data(leafDER) as CFData))
        let ca = try #require(SecCertificateCreateWithData(nil, Data(material.certificateDER) as CFData))

        let trust = try #require(makeTrust(leaf: leaf, anchor: ca, host: "127.0.0.1"))
        #expect(SecTrustEvaluateWithError(trust, nil))
    }

    /// Доверие с нашим CA как единственным якорем и проверкой имени хоста
    private func makeTrust(leaf: SecCertificate, anchor: SecCertificate, host: String) -> SecTrust? {
        var trust: SecTrust?
        let status = SecTrustCreateWithCertificates(
            [leaf] as CFArray,
            SecPolicyCreateSSL(true, host as CFString),
            &trust
        )
        guard status == errSecSuccess, let trust else { return nil }
        SecTrustSetAnchorCertificates(trust, [anchor] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        return trust
    }

    @Test
    func contextIsReusedPerHost() throws {
        let authority = try CertificateAuthority()
        let first = try authority.context(forHost: "example.com")
        let second = try authority.context(forHost: "example.com")
        let other = try authority.context(forHost: "other.example")
        #expect(first === second)
        #expect(first !== other)
    }

    @Test
    func issuedCertificateIsLoadableByNIOSSL() throws {
        let authority = try CertificateAuthority()
        let leafDER = try authority.certificateDER(forHost: "127.0.0.1")
        _ = try NIOSSLCertificate(bytes: leafDER, format: .der)
        let leaf = try CertificateAuthority.makeLeafKey()
        _ = try NIOSSLPrivateKey(bytes: leaf.pkcs8, format: .der)
    }
}
