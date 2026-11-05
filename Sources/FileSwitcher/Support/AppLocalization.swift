import Foundation

/// Язык интерфейса и перевод русских строк на английский
enum L10n {
    /// Доступные языки интерфейса
    enum Language: String, CaseIterable {
        case ru
        case en

        /// Подпись языка в настройках
        var title: String {
            switch self {
            case .ru: return "Русский"
            case .en: return "English"
            }
        }
    }

    static let languageKey = "FileSwitcher.language"

    /// Текущий язык интерфейса
    static var language: Language {
        let stored = UserDefaults.standard.string(forKey: languageKey) ?? ""
        return Language(rawValue: stored) ?? .ru
    }

    /// Запоминает выбранный язык
    static func save(_ language: Language) {
        UserDefaults.standard.set(language.rawValue, forKey: languageKey)
    }

    /// Перевод строки интерфейса; русский текст служит ключом словаря
    static func t(_ key: String) -> String {
        guard language == .en else {
            return key
        }
        return english[key] ?? key
    }
}
