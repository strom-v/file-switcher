import Foundation

/// Формат экспорта журнала
enum LogExportFormat: String, CaseIterable {
    case har
    case json
    case csv
}

/// Потоковый экспорт JSONL-сессии в HAR, JSON или CSV
enum LogExport {
    private static let csvColumns = ["time", "method", "url", "status", "event", "file", "responseSize"]

    /// ISO-время события с миллисекундами
    static func isoDate(_ ts: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date(timeIntervalSince1970: ts))
    }

    /// Экранирует ячейку CSV
    private static func csvCell(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }

    /// Строка CSV для одного события
    private static func csvRow(_ event: ProxyLogEvent) -> String {
        let cells = [
            isoDate(event.ts),
            event.method,
            event.url,
            event.statusCode.map(String.init) ?? "",
            event.event.rawValue,
            event.file,
            String(event.responseSize)
        ]
        return cells.map(csvCell).joined(separator: ",")
    }

    /// Событие журнала → HAR entry (1.2); тайминги недоступны, поэтому нули
    static func harEntry(_ event: ProxyLogEvent) -> [String: Any] {
        let mimeType = event.responseHeaders["Content-Type"] ?? event.responseHeaders["content-type"] ?? ""
        var request: [String: Any] = [
            "method": event.method,
            "url": event.url,
            "httpVersion": "HTTP/1.1",
            "cookies": [],
            "headers": harHeaders(event.requestHeaders),
            "queryString": [],
            "headersSize": -1,
            "bodySize": event.requestBodySize
        ]
        if !event.requestBody.isEmpty, !event.requestBodyIsBinary {
            request["postData"] = ["mimeType": "", "text": event.requestBody]
        }
        var content: [String: Any] = ["size": event.responseSize, "mimeType": mimeType]
        if !event.responseBody.isEmpty, !event.responseBodyIsBinary {
            content["text"] = event.responseBody
        }
        var entry: [String: Any] = [
            "startedDateTime": isoDate(event.ts),
            "time": 0,
            "request": request,
            "response": [
                "status": event.statusCode ?? 0,
                "statusText": "",
                "httpVersion": "HTTP/1.1",
                "cookies": [],
                "headers": harHeaders(event.responseHeaders),
                "content": content,
                "redirectURL": "",
                "headersSize": -1,
                "bodySize": event.responseSize
            ],
            "cache": [:],
            "timings": ["send": 0, "wait": 0, "receive": 0],
            "_fileSwitcherEvent": event.event.rawValue
        ]
        if !event.file.isEmpty {
            entry["_fileSwitcherSubstitutedFile"] = event.file
        }
        return entry
    }

    /// Заголовки в формате HAR
    private static func harHeaders(_ headers: [String: String]) -> [[String: String]] {
        headers.keys.sorted().map { ["name": $0, "value": headers[$0] ?? ""] }
    }

    /// Кодирует JSON-объект с отступом и дополнительным сдвигом строк
    private static func encode(_ object: Any, extraIndent: String) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        let text = String(decoding: data, as: UTF8.self)
        guard !extraIndent.isEmpty else {
            return text
        }
        return text
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { extraIndent + $0 }
            .joined(separator: "\n")
    }

    /// Потоково переносит события сессии в выбранный формат
    static func stream(sourcePath: String, destinationPath: String, format: LogExportFormat) throws {
        guard FileManager.default.createFile(atPath: destinationPath, contents: nil),
              let output = FileHandle(forWritingAtPath: destinationPath) else {
            throw CocoaError(.fileWriteUnknown)
        }
        defer {
            try? output.close()
        }
        switch format {
        case .json:
            try write(output, "[\n")
        case .har:
            try write(
                output,
                "{\n  \"log\": {\n    \"version\": \"1.2\",\n    \"creator\": { \"name\": \"FileSwitcher\", \"version\": \"0.1.0\" },\n    \"entries\": [\n"
            )
        case .csv:
            try write(output, csvColumns.joined(separator: ","))
        }

        var isFirst = true
        try forEachEvent(in: sourcePath) { event in
            switch format {
            case .csv:
                try write(output, "\n" + csvRow(event))
            case .json:
                if !isFirst {
                    try write(output, ",\n")
                }
                try write(output, try encode(event.dictionary(), extraIndent: "  "))
            case .har:
                if !isFirst {
                    try write(output, ",\n")
                }
                try write(output, try encode(harEntry(event), extraIndent: "      "))
            }
            isFirst = false
        }

        switch format {
        case .json:
            try write(output, "\n]\n")
        case .har:
            try write(output, "\n    ]\n  }\n}\n")
        case .csv:
            try write(output, "\n")
        }
    }

    /// Идёт по JSONL-файлу построчно, пропуская битые строки
    private static func forEachEvent(in path: String, body: (ProxyLogEvent) throws -> Void) throws {
        guard let input = FileHandle(forReadingAtPath: path) else {
            return
        }
        defer {
            try? input.close()
        }
        let decoder = JSONDecoder()
        var buffer = Data()
        var isDone = false
        while !isDone {
            let chunk = input.readData(ofLength: 1 << 20)
            if chunk.isEmpty {
                isDone = true
            }
            buffer.append(chunk)
            while let breakIndex = buffer.firstIndex(of: 0x0A) {
                let lineData = buffer[buffer.startIndex..<breakIndex]
                buffer = buffer[buffer.index(after: breakIndex)...]
                guard !lineData.isEmpty,
                      let event = try? decoder.decode(ProxyLogEvent.self, from: Data(lineData)) else {
                    continue
                }
                try body(event)
            }
        }
        if !buffer.isEmpty, let event = try? decoder.decode(ProxyLogEvent.self, from: buffer) {
            try body(event)
        }
    }

    /// Пишет строку в файл
    private static func write(_ handle: FileHandle, _ text: String) throws {
        try handle.write(contentsOf: Data(text.utf8))
    }
}

/// Полное представление события для экспорта в JSON
extension ProxyLogEvent {
    /// Словарь всех полей события
    func dictionary() -> [String: Any] {
        var result: [String: Any] = [
            "event": event.rawValue,
            "url": url,
            "file": file,
            "method": method,
            "requestHeaders": requestHeaders,
            "responseHeaders": responseHeaders,
            "responseSize": responseSize,
            "ts": ts,
            "requestBody": requestBody,
            "requestBodyIsBinary": requestBodyIsBinary,
            "requestBodySize": requestBodySize,
            "responseBody": responseBody,
            "responseBodyIsBinary": responseBodyIsBinary
        ]
        if let statusCode {
            result["statusCode"] = statusCode
        }
        return result
    }
}
