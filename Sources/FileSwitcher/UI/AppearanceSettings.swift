import AppKit

/// Тема интерфейса из меню «Вид»; выбор сохраняется между запусками
@MainActor
enum AppearanceSettings {
    /// Доступные варианты темы
    enum Mode: String, CaseIterable {
        case system
        case light
        case dark

        /// Подпись пункта меню
        var title: String {
            switch self {
            case .system: return L10n.t("Системная")
            case .light: return L10n.t("Светлая")
            case .dark: return L10n.t("Тёмная")
            }
        }

        /// Тема AppKit или nil для следования системной
        var appearance: NSAppearance? {
            switch self {
            case .system: return nil
            case .light: return NSAppearance(named: .aqua)
            case .dark: return NSAppearance(named: .darkAqua)
            }
        }
    }

    private static let key = "FileSwitcher.appearance"

    /// Текущая выбранная тема
    static var mode: Mode {
        let stored = UserDefaults.standard.string(forKey: key) ?? ""
        return Mode(rawValue: stored) ?? .system
    }

    /// Применяет тему и запоминает выбор
    static func apply(_ mode: Mode) {
        UserDefaults.standard.set(mode.rawValue, forKey: key)
        NSApp.appearance = mode.appearance
    }

    /// Применяет сохранённую тему при запуске
    static func applyStored() {
        NSApp.appearance = mode.appearance
    }
}
