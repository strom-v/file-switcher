import Foundation

/// Имена заголовков с секретами: значения не попадают в журнал, файл которого целиком уходит в экспорт
enum RedactedHeaders {
    static let names: Set<String> = [
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-auth-token",
        "x-csrf-token",
        "x-xsrf-token"
    ]

    static let placeholder = "<redacted by FileSwitcher>"

    /// Заменяет значения секретных заголовков заглушкой, сохраняя имена и регистр
    static func redact(_ headers: [String: String]) -> [String: String] {
        var result: [String: String] = [:]
        for (name, value) in headers {
            result[name] = names.contains(name.lowercased()) ? placeholder : value
        }
        return result
    }
}
