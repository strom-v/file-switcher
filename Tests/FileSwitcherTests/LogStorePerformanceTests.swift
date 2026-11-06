import Foundation
import Testing
@testable import FileSwitcher

/// Замеры скорости хранилища журнала: печатают время операций, проверяют только результат
@Suite("Скорость журнала")
struct LogStorePerformanceTests {
    /// Событие для замеров: короткое тело, чтобы мерить накладные расходы хранилища
    private func makeEvent(index: Int) -> ProxyLogEvent {
        ProxyLogEvent(
            event: .passed,
            url: "https://example.com/items/\(index)?page=\(index % 97)",
            file: "",
            method: "GET",
            statusCode: 200,
            requestHeaders: ["host": "example.com", "user-agent": "perf"],
            responseHeaders: ["content-type": "application/json"],
            responseSize: 256,
            ts: Double(index),
            requestBody: "",
            requestBodyIsBinary: false,
            requestBodySize: 0,
            responseBody: String(repeating: "{\"k\":\"v\"}", count: 32),
            responseBodyIsBinary: false
        )
    }

    /// Временный каталог под файлы журнала
    private func makeDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    @Test("скорость записи, чтения и поиска")
    func throughput() async throws {
        let directory = try makeDirectory()
        defer {
            try? FileManager.default.removeItem(at: directory)
        }

        // файл прошлой сессии, чтобы замерить поиск по истории
        let previous = LogStore(directory: directory)
        var previousBatch: [ProxyLogEvent] = []
        for index in 0..<20_000 {
            previousBatch.append(makeEvent(index: index))
            if previousBatch.count == 500 {
                _ = previous.appendBatch(previousBatch)
                previousBatch.removeAll(keepingCapacity: true)
            }
        }
        try await Task.sleep(for: .milliseconds(5))

        let store = LogStore(directory: directory)
        let appendStart = Date()
        var batch: [ProxyLogEvent] = []
        for index in 0..<50_000 {
            batch.append(makeEvent(index: index))
            if batch.count == 500 {
                _ = store.appendBatch(batch)
                batch.removeAll(keepingCapacity: true)
            }
        }
        print("perf запись 50k: \(milliseconds(since: appendStart))")

        let readStart = Date()
        var found = 0
        for index in stride(from: 0, to: 50_000, by: 25) {
            if store.getEvent(ts: Double(index)) != nil {
                found += 1
            }
        }
        #expect(found == 2_000)
        print("perf getEvent 2000: \(milliseconds(since: readStart))")

        let bodyStart = Date()
        let byBody = store.search(query: "k\":\"v", searchInBody: true)
        #expect(byBody.count == 2_000)
        print("perf поиск по телу: \(milliseconds(since: bodyStart))")

        let historyStart = Date()
        let fromHistory = store.search(query: "items/19", searchInBody: false, includeHistory: true)
        #expect(fromHistory.contains { $0.ts == 19_000 })
        print("perf поиск по истории: \(milliseconds(since: historyStart))")

        let missStart = Date()
        let miss = store.search(query: "нет-такого", searchInBody: false, includeHistory: true)
        #expect(miss.isEmpty)
        print("perf поиск по истории без совпадений: \(milliseconds(since: missStart))")

        let asciiMissStart = Date()
        let asciiMiss = store.search(query: "zzzzz-miss", searchInBody: false, includeHistory: true)
        #expect(asciiMiss.isEmpty)
        print("perf поиск по истории без совпадений (ASCII): \(milliseconds(since: asciiMissStart))")
    }

    /// Время в миллисекундах от отметки
    private func milliseconds(since start: Date) -> String {
        String(format: "%.1f мс", Date().timeIntervalSince(start) * 1000)
    }
}
