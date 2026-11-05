import Foundation

/// Сработавшее правило и группы regex-совпадения для подстановки в путь файла
struct RuleMatch: Sendable {
    var rule: Rule
    var groups: [String]?
}

/// Тело подмены, готовое к отправке клиенту
struct ReplacementBody: Sendable {
    var body: Data
    var contentType: String
    /// Путь файла подмены для журнала; пустая строка — тело задано прямо в правиле
    var file: String
}

/// Источник правил для прокси: отделён от реализации, чтобы ядро прокси тестировалось без файлов
protocol RuleEngine: Sendable {
    /// Правило для URL, если оно есть и включено
    func match(_ url: String) -> RuleMatch?
    /// Тело подмены; nil — правило меняет только заголовки, задержку или статус
    func replacementBody(for match: RuleMatch) throws -> ReplacementBody?
}
