import Foundation
import NIOHTTP1
import Testing
@testable import FileSwitcher

/// Разбор адресов и заголовков прокси-запроса
@Suite("Разбор HTTP-сообщений")
struct HttpMessageTests {
    @Test("authority с портом и без")
    func parseAuthorityCases() {
        #expect(parseAuthority("example.com:8080", defaultPort: 80).port == 8080)
        #expect(parseAuthority("example.com", defaultPort: 443).host == "example.com")
        #expect(parseAuthority("example.com", defaultPort: 443).port == 443)
        #expect(parseAuthority("[::1]:8443", defaultPort: 443).host == "::1")
        #expect(parseAuthority("[::1]:8443", defaultPort: 443).port == 8443)
        #expect(parseAuthority("[::1]", defaultPort: 443).port == 443)
    }

    @Test("absolute-form разбирается на адрес и путь")
    func parseAbsoluteFormCases() throws {
        let plain = try #require(parseAbsoluteForm("http://example.com/a?b=1"))
        #expect(plain.target.scheme == .http)
        #expect(plain.target.port == 80)
        #expect(plain.path == "/a?b=1")

        let secure = try #require(parseAbsoluteForm("https://example.com:8443"))
        #expect(secure.target.port == 8443)
        #expect(secure.path == "/")

        #expect(parseAbsoluteForm("/local/path") == nil)
        #expect(parseAbsoluteForm("ftp://example.com/") == nil)
    }

    @Test("URL для сравнения с правилами опускает порт по умолчанию")
    func prettyUrlCases() {
        let target = ProxyTarget(scheme: .https, host: "Example.com", port: 443)
        #expect(prettyUrl(target: target, hostHeader: "example.com", path: "/a") == "https://example.com/a")

        let custom = ProxyTarget(scheme: .http, host: "example.com", port: 8080)
        #expect(prettyUrl(target: custom, hostHeader: "example.com:8080", path: "/a") == "http://example.com:8080/a")
    }

    @Test("hop-by-hop заголовки не пересылаются")
    func forwardableHeadersDropHopByHop() {
        var headers = HTTPHeaders()
        headers.add(name: "Host", value: "example.com")
        headers.add(name: "Connection", value: "keep-alive, X-Custom")
        headers.add(name: "Keep-Alive", value: "timeout=5")
        headers.add(name: "X-Custom", value: "1")
        headers.add(name: "X-Kept", value: "2")

        let names = forwardableHeaders(headers).map { $0.0.lowercased() }
        #expect(names.contains("host"))
        #expect(names.contains("x-kept"))
        #expect(!names.contains("connection"))
        #expect(!names.contains("keep-alive"))
        #expect(!names.contains("x-custom"))
    }

    @Test("accept-encoding не пересылается апстриму: тело ответа остаётся читаемым")
    func forwardableRequestHeadersDropAcceptEncoding() {
        var headers = HTTPHeaders()
        headers.add(name: "Host", value: "example.com")
        headers.add(name: "Accept-Encoding", value: "gzip, br")
        headers.add(name: "X-Kept", value: "1")

        let names = forwardableRequestHeaders(headers).map { $0.0.lowercased() }
        #expect(names.contains("host"))
        #expect(names.contains("x-kept"))
        #expect(!names.contains("accept-encoding"))
    }

    @Test("журнал склеивает повторы и прячет секреты")
    func headersForLogMergesAndRedacts() {
        let pairs = [
            ("Set-Cookie", "a=1"),
            ("set-cookie", "b=2"),
            ("Accept", "*/*")
        ]
        let logged = headersForLog(pairs)
        #expect(logged["Set-Cookie"] == RedactedHeaders.placeholder)
        #expect(logged["Accept"] == "*/*")
    }

    @Test("тело для журнала ограничено 64 КБ и полноразмерно посчитано")
    func bodyCaptureLimits() {
        let capture = BodyCapture()
        capture.add(bytes: [UInt8](repeating: 0x61, count: 100 * 1024))
        #expect(capture.size == 100 * 1024)
        let decoded = capture.decode()
        #expect(decoded.text.utf8.count == bodyCaptureLimitBytes)
        #expect(!decoded.isBinary)
    }

    @Test("бинарное тело не декодируется как текст")
    func binaryBodyDetected() {
        let capture = BodyCapture()
        capture.add(bytes: [0xFF, 0xFE, 0x00])
        let decoded = capture.decode()
        #expect(decoded.isBinary)
        #expect(decoded.text.isEmpty)
    }
}
