import Foundation

/// Хранит и сохраняет правила подмены в rules.json. Сообщает о повреждённом файле, иначе
/// потеря правил была бы видна только в консоли, недоступной пользователю
final class RulesStore: @unchecked Sendable {
    private let fileURL: URL
    private let lock = NSLock()

    /// Вызывается, когда файл существует, но не разбирается как JSON
    var onCorrupted: (@Sendable (String) -> Void)?

    init(fileURL: URL = AppPaths.rulesFile) {
        self.fileURL = fileURL
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            // userData может быть недоступен для записи - не роняем запуск, ошибка всплывёт при сохранении
            try? JsonFile.write(RulesFile(rules: []), to: fileURL)
        }
    }

    /// Путь к файлу правил
    var filePath: String {
        fileURL.path
    }

    /// Все правила из файла (с проставленными группами)
    func all() -> [Rule] {
        read()
    }

    /// Сохраняет набор правил: сначала валидирует, затем пишет атомарно
    func saveAll(_ rules: [Rule]) throws -> [Rule] {
        for rule in rules {
            try validateRule(rule)
        }
        let normalized = rulesWithGroups(rules) ?? rules
        try write(normalized)
        return normalized
    }

    /// Читает файл, мигрирует группы и сообщает о порче
    private func read() -> [Rule] {
        let fallback = RulesFile(rules: [])
        let parsed = JsonFile.read(RulesFile.self, at: fileURL, fallback: fallback) { [weak self] message in
            self?.reportCorrupted(message)
        }
        // валидный JSON, но не { rules: [...] } - иначе первый же rules:get упал бы
        guard !parsed.rules.isEmpty || containsRulesArray() else {
            return []
        }
        // одноразовая миграция: правилам без явной группы проставляем её из пути подмены
        if let migrated = rulesWithGroups(parsed.rules) {
            try? write(migrated)
            return migrated
        }
        return parsed.rules
    }

    /// Есть ли в файле поле rules в виде массива
    private func containsRulesArray() -> Bool {
        guard let object = try? JsonFile.readObject(at: fileURL) else {
            return false
        }
        guard let rules = object["rules"] else {
            return true
        }
        if !(rules is [Any]) {
            reportCorrupted("rules.json: поле \"rules\" не является массивом")
            return false
        }
        return true
    }

    /// Записывает правила в файл
    private func write(_ rules: [Rule]) throws {
        try JsonFile.write(RulesFile(rules: rules), to: fileURL)
    }

    private func reportCorrupted(_ message: String) {
        onCorrupted?(message)
    }
}
