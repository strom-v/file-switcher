import Foundation

/// Текстовое описание записи журнала для панели деталей
enum EventFormatter {
    /// Многострочное описание: адрес, заголовки, тела
    static func describe(_ event: ProxyLogEvent) -> String {
        var lines: [String] = []
        lines.append("\(event.method) \(event.url)")
        if !event.file.isEmpty {
            lines.append("файл подмены: \(event.file)")
        }
        lines.append("статус: \(event.statusCode.map(String.init) ?? "-"), размер ответа: \(event.responseSize) Б")
        lines.append("")
        lines.append("== запрос ==")
        lines.append(contentsOf: event.requestHeaders.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" })
        if event.requestBodySize > 0 {
            lines.append(event.requestBodyIsBinary ? "[тело \(event.requestBodySize) Б, бинарное]" : event.requestBody)
        }
        lines.append("")
        lines.append("== ответ ==")
        lines.append(contentsOf: event.responseHeaders.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" })
        if event.responseSize > 0 {
            lines.append(event.responseBodyIsBinary ? "[тело \(event.responseSize) Б, бинарное]" : event.responseBody)
        }
        return lines.joined(separator: "\n")
    }
}
