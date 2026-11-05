import Foundation
import Testing

@testable import FileSwitcher

@Suite("Экспорт журнала")
struct LogExportTests {
    /// Строит временную JSONL-сессию из двух событий
    private func makeSession() throws -> (source: String, directory: URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("log-export-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let source = directory.appendingPathComponent("session.jsonl").path
        let events = [
            ProxyLogEvent(
                event: .matched,
                url: "https://example.com/api?a=1,2",
                file: "/tmp/body.json",
                method: "GET",
                statusCode: 202,
                requestHeaders: ["Accept": "*/*"],
                responseHeaders: ["Content-Type": "application/json"],
                responseSize: 12,
                ts: 1_760_000_000.5,
                requestBody: "",
                requestBodyIsBinary: false,
                requestBodySize: 0,
                responseBody: "{\"ok\":true}",
                responseBodyIsBinary: false
            ),
            ProxyLogEvent(
                event: .replay,
                url: "https://example.com/other",
                file: "",
                method: "POST",
                statusCode: nil,
                requestHeaders: [:],
                responseHeaders: [:],
                responseSize: 0,
                ts: 1_760_000_001,
                requestBody: "{}",
                requestBodyIsBinary: false,
                requestBodySize: 2,
                responseBody: "",
                responseBodyIsBinary: false
            )
        ]
        let encoder = JSONEncoder()
        var payload = ""
        for event in events {
            payload += String(decoding: try encoder.encode(event), as: UTF8.self) + "\n"
        }
        payload += "битая строка\n"
        try payload.write(toFile: source, atomically: true, encoding: .utf8)
        return (source, directory)
    }

    @Test("CSV содержит шапку и экранирует запятые")
    func csvContainsHeaderAndEscapes() throws {
        let (source, directory) = try makeSession()
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let destination = directory.appendingPathComponent("out.csv").path
        try LogExport.stream(sourcePath: source, destinationPath: destination, format: .csv)
        let text = try String(contentsOfFile: destination, encoding: .utf8)
        #expect(text.hasPrefix("time,method,url,status,event,file,responseSize"))
        #expect(text.contains("\"https://example.com/api?a=1,2\""))
        #expect(text.contains(",matched,"))
    }

    @Test("HAR содержит корректный JSON с двумя записями")
    func harHasTwoEntries() throws {
        let (source, directory) = try makeSession()
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let destination = directory.appendingPathComponent("out.har").path
        try LogExport.stream(sourcePath: source, destinationPath: destination, format: .har)
        let data = try Data(contentsOf: URL(fileURLWithPath: destination))
        let root = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        let log = try #require(root["log"] as? [String: Any])
        let entries = try #require(log["entries"] as? [[String: Any]])
        #expect(entries.count == 2)
        let response = try #require(entries[0]["response"] as? [String: Any])
        #expect(response["status"] as? Int == 202)
    }

    @Test("JSON-экспорт даёт массив событий")
    func jsonIsArray() throws {
        let (source, directory) = try makeSession()
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let destination = directory.appendingPathComponent("out.json").path
        try LogExport.stream(sourcePath: source, destinationPath: destination, format: .json)
        let data = try Data(contentsOf: URL(fileURLWithPath: destination))
        let items = try #require(try JSONSerialization.jsonObject(with: data) as? [[String: Any]])
        #expect(items.count == 2)
        #expect(items[1]["statusCode"] == nil)
    }
}
