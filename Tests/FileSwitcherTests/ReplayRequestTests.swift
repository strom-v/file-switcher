import Foundation
import Testing

@testable import FileSwitcher

@Suite("Повтор запроса")
struct ReplayRequestTests {
    /// Событие журнала для проверок
    private func makeEvent(url: String, body: String = "", isBinary: Bool = false) -> ProxyLogEvent {
        ProxyLogEvent(
            event: .passed,
            url: url,
            file: "",
            method: "GET",
            statusCode: 200,
            requestHeaders: ["Cookie": "secret=1", "X-Trace": "abc"],
            responseHeaders: [:],
            responseSize: 0,
            ts: 0,
            requestBody: body,
            requestBodyIsBinary: isBinary,
            requestBodySize: body.utf8.count,
            responseBody: "",
            responseBodyIsBinary: false
        )
    }

    @Test("Публичность адресов")
    func ipPublicity() {
        #expect(IPAddress.isPublic("8.8.8.8"))
        #expect(IPAddress.isPublic("2606:4700::1111"))
        #expect(!IPAddress.isPublic("127.0.0.1"))
        #expect(!IPAddress.isPublic("10.1.2.3"))
        #expect(!IPAddress.isPublic("172.20.0.1"))
        #expect(!IPAddress.isPublic("192.168.1.10"))
        #expect(!IPAddress.isPublic("169.254.1.1"))
        #expect(!IPAddress.isPublic("::1"))
        #expect(!IPAddress.isPublic("fe80::1"))
        #expect(!IPAddress.isPublic("fd00::1"))
    }

    @Test("Разбор литералов")
    func parsesLiterals() {
        #expect(IPAddress.parse("192.168.0.1") != nil)
        #expect(IPAddress.parse("[::1]") == "::1")
        #expect(IPAddress.parse("example.com") == nil)
    }

    @Test("Бинарное тело не повторяется")
    func rejectsBinaryBody() async {
        let event = makeEvent(url: "https://example.com/api", body: "aa", isBinary: true)
        await #expect(throws: ReplayRequestError.self) {
            _ = try await ReplayRequest.replay(event)
        }
    }

    @Test("Локальный хост отклоняется до запроса")
    func rejectsLocalhost() async {
        let event = makeEvent(url: "http://localhost:8080/api")
        await #expect(throws: ReplayRequestError.self) {
            _ = try await ReplayRequest.replay(event)
        }
    }

    @Test("Приватный IP отклоняется до запроса")
    func rejectsPrivateAddress() async {
        let event = makeEvent(url: "http://10.0.0.5/api")
        await #expect(throws: ReplayRequestError.self) {
            _ = try await ReplayRequest.replay(event)
        }
    }
}
