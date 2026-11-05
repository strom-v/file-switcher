import Foundation

/// Тип записи журнала: подмена сработала, запрос прошёл насквозь, повтор из журнала
enum ProxyLogEventType: String, Codable, Sendable {
    case matched
    case passed
    case replay
}

/// Лёгкая запись журнала для списка — тела и заголовки лежат на диске и читаются по ts
struct LogEntryMeta: Codable, Sendable, Equatable {
    var event: ProxyLogEventType
    var url: String
    var file: String
    var method: String
    var statusCode: Int?
    var responseSize: Int
    var ts: Double
    var requestBodyIsBinary: Bool
    var requestBodySize: Int
    var responseBodyIsBinary: Bool
}

/// Полная запись журнала — так она лежит строкой в файле сессии
struct ProxyLogEvent: Codable, Sendable {
    var event: ProxyLogEventType
    var url: String
    var file: String
    var method: String
    var statusCode: Int?
    var requestHeaders: [String: String]
    var responseHeaders: [String: String]
    var responseSize: Int
    var ts: Double
    var requestBody: String
    var requestBodyIsBinary: Bool
    var requestBodySize: Int
    var responseBody: String
    var responseBodyIsBinary: Bool

    /// Лёгкая версия записи для списка в UI
    func meta() -> LogEntryMeta {
        LogEntryMeta(
            event: event,
            url: url,
            file: file,
            method: method,
            statusCode: statusCode,
            responseSize: responseSize,
            ts: ts,
            requestBodyIsBinary: requestBodyIsBinary,
            requestBodySize: requestBodySize,
            responseBodyIsBinary: responseBodyIsBinary
        )
    }
}
