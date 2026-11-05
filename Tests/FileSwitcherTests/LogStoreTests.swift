import Foundation
import Testing
@testable import FileSwitcher

/// Запись и чтение журнала трафика
@Suite("Хранилище журнала")
struct LogStoreTests {
    /// Событие с минимальным набором полей
    private func makeEvent(url: String, ts: Double, responseBody: String = "ok") -> ProxyLogEvent {
        ProxyLogEvent(
            event: .passed,
            url: url,
            file: "",
            method: "GET",
            statusCode: 200,
            requestHeaders: ["host": "example.com"],
            responseHeaders: ["content-type": "text/plain"],
            responseSize: responseBody.utf8.count,
            ts: ts,
            requestBody: "",
            requestBodyIsBinary: false,
            requestBodySize: 0,
            responseBody: responseBody,
            responseBodyIsBinary: false
        )
    }

    @Test("пачка пишется в файл, событие читается по ts")
    func appendAndRead() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let store = LogStore(directory: directory)
        let metas = store.appendBatch([
            makeEvent(url: "https://example.com/a", ts: 1.5, responseBody: "first"),
            makeEvent(url: "https://example.com/b", ts: 2.5, responseBody: "second")
        ])
        #expect(metas.count == 2)
        #expect(store.hasExportableEvents())
        #expect(store.getRecent().count == 2)

        let event = try #require(store.getEvent(ts: 2.5))
        #expect(event.url == "https://example.com/b")
        #expect(event.responseBody == "second")
        #expect(store.getEvent(ts: 999) == nil)
    }

    @Test("поиск идёт по url и, при флаге, по телу")
    func searchFindsByURLAndBody() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let store = LogStore(directory: directory)
        _ = store.appendBatch([
            makeEvent(url: "https://example.com/orders", ts: 10, responseBody: "{\"secret\":42}"),
            makeEvent(url: "https://example.com/users", ts: 11, responseBody: "[]")
        ])

        let byURL = store.search(query: "orders", searchInBody: false)
        #expect(byURL.map(\.ts) == [10])

        let byBody = store.search(query: "secret", searchInBody: true)
        #expect(byBody.map(\.ts) == [10])

        let all = store.search(query: "  ", searchInBody: false)
        #expect(all.count == 2)
    }
}
