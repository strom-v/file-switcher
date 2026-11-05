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
        lines.append(L10n.t("== запрос =="))
        lines.append(contentsOf: event.requestHeaders.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" })
        if event.requestBodySize > 0 {
            lines.append(event.requestBodyIsBinary ? "[тело \(event.requestBodySize) Б, бинарное]" : event.requestBody)
        }
        lines.append("")
        lines.append(L10n.t("== ответ =="))
        lines.append(contentsOf: event.responseHeaders.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value)" })
        if event.responseSize > 0 {
            lines.append(event.responseBodyIsBinary ? "[тело \(event.responseSize) Б, бинарное]" : event.responseBody)
        }
        return lines.joined(separator: "\n")
    }

    /// Заголовки в виде L10n.t("ключ: значение") по одному в строке
    static func headers(_ headers: [String: String]) -> String {
        guard !headers.isEmpty else {
            return L10n.t("(заголовков нет)")
        }
        return headers.keys.sorted().compactMap { key in
            headers[key].map { "\(key): \($0)" }
        }.joined(separator: "\n")
    }

    /// Готовая команда curl для повторной отправки запроса из терминала
    static func curl(_ event: ProxyLogEvent) -> String {
        let skipped = ["host", "content-length", "accept-encoding", "connection"]
        var parts = ["curl"]
        if event.method != "GET" {
            parts.append("-X \(event.method)")
        }
        for key in event.requestHeaders.keys.sorted() where !skipped.contains(key.lowercased()) {
            guard let value = event.requestHeaders[key] else {
                continue
            }
            parts.append("-H \(SystemProxyDarwin.shellQuote("\(key): \(value)"))")
        }
        if !event.requestBody.isEmpty, !event.requestBodyIsBinary {
            parts.append("--data-raw \(SystemProxyDarwin.shellQuote(event.requestBody))")
        }
        parts.append(SystemProxyDarwin.shellQuote(event.url))
        return parts.joined(separator: " \\\n  ")
    }
}

