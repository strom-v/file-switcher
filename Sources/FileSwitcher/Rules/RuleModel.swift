import Foundation

/// Пара имя/значение заголовка; пустое value означает удаление заголовка
struct HeaderOverride: Codable, Sendable, Equatable {
    var name: String
    var value: String
}

/// Правило подмены: что искать в трафике и чем отвечать
struct Rule: Codable, Sendable, Equatable, Identifiable {
    var id: String
    var enabled: Bool
    var urlPattern: String
    var isRegex: Bool
    /// Группа в списке правил; nil — ещё не мигрировано (определится из пути при загрузке)
    var group: String?
    /// Пусто — запрос идёт на реальный сервер, применяются только остальные модификации
    var localFilePath: String?
    /// Тело ответа прямо в правиле; приоритетнее localFilePath
    var responseBody: String?
    var contentType: String?
    var requestHeaderOverrides: [HeaderOverride]?
    var responseHeaderOverrides: [HeaderOverride]?
    /// Задержка перед ответом в миллисекундах
    var delayMs: Int?
    /// Подменяет HTTP-статус ответа
    var statusCodeOverride: Int?
}

/// Файл правил целиком — тот же формат, что у Electron-версии
struct RulesFile: Codable, Sendable {
    var rules: [Rule]
}
