import Foundation
import Testing

@testable import FileSwitcher

struct DerEncoderTests {
    @Test
    func lengthUsesShortFormBelow128() {
        #expect(Der.encodeLength(0) == [0x00])
        #expect(Der.encodeLength(127) == [0x7f])
    }

    @Test
    func lengthUsesLongFormAbove127() {
        #expect(Der.encodeLength(128) == [0x81, 0x80])
        #expect(Der.encodeLength(300) == [0x82, 0x01, 0x2c])
    }

    @Test
    func integerDropsLeadingZerosAndKeepsSign() {
        #expect(Der.integer([0x00, 0x01]) == [0x02, 0x01, 0x01])
        #expect(Der.integer([0x00, 0x80]) == [0x02, 0x02, 0x00, 0x80])
        #expect(Der.integer([0x7f]) == [0x02, 0x01, 0x7f])
        #expect(Der.integer(1) == [0x02, 0x01, 0x01])
        #expect(Der.integer(0x0102) == [0x02, 0x02, 0x01, 0x02])
    }

    @Test
    func oidMatchesRFCEncoding() {
        // rsaEncryption
        #expect(Der.oid("1.2.840.113549.1.1.11") == [
            0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b
        ])
        // commonName
        #expect(Der.oid("2.5.4.3") == [0x06, 0x03, 0x55, 0x04, 0x03])
        // subjectAltName
        #expect(Der.oid("2.5.29.17") == [0x06, 0x03, 0x55, 0x1d, 0x11])
    }

    @Test
    func stringsAndContainers() {
        #expect(Der.utf8String("ab") == [0x0c, 0x02, 0x61, 0x62])
        #expect(Der.sequence(Der.null()) == [0x30, 0x02, 0x05, 0x00])
        #expect(Der.set(Der.integer(1)) == [0x31, 0x03, 0x02, 0x01, 0x01])
        #expect(Der.bitString([0xa0], unusedBits: 5) == [0x03, 0x02, 0x05, 0xa0])
        #expect(Der.contextTag(3, Der.null()) == [0xa3, 0x02, 0x05, 0x00])
        #expect(Der.contextTag(2, Array("a".utf8), constructed: false) == [0x82, 0x01, 0x61])
    }

    @Test
    func utcTimeIsTwoDigitYearWithSeconds() {
        var components = DateComponents()
        components.year = 2026
        components.month = 11
        components.day = 5
        components.hour = 9
        components.minute = 7
        components.second = 3
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        let date = calendar.date(from: components)!
        #expect(Der.utcTime(date) == Array([0x17, 0x0d] + Array("261105090703Z".utf8)))
    }

    @Test
    func subjectIsExtractedFromCertificate() throws {
        let subject = Der.sequence(
            Der.set(Der.sequence(Der.oid("2.5.4.3"), Der.utf8String("ca.example")))
        )
        let issuer = Der.sequence(Der.set(Der.sequence(Der.oid("2.5.4.3"), Der.utf8String("root"))))
        let tbs = Der.sequence(
            Der.contextTag(0, Der.integer(2)),
            Der.integer([0x01]),
            Der.sequence(Der.oid("1.2.840.113549.1.1.11"), Der.null()),
            issuer,
            Der.sequence(Der.utcTime(Date()), Der.utcTime(Date())),
            subject,
            Der.sequence(Der.sequence(Der.oid("1.2.840.113549.1.1.1"), Der.null()), Der.bitString([0x00]))
        )
        let certificate = Der.sequence(
            tbs,
            Der.sequence(Der.oid("1.2.840.113549.1.1.11"), Der.null()),
            Der.bitString([0x01, 0x02])
        )
        #expect(DerReader.subjectDER(inCertificate: certificate) == subject)
    }

    @Test
    func elementParserRejectsTruncatedInput() {
        #expect(DerReader.element(in: [0x30, 0x05, 0x01], at: 0, limit: 3) == nil)
        #expect(DerReader.element(in: [0x30], at: 0, limit: 1) == nil)
        #expect(DerReader.element(in: [0x30, 0x01, 0xff], at: 0, limit: 3)?.end == 3)
    }
}
