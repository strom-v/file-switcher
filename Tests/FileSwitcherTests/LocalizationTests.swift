import Foundation
import Testing
@testable import FileSwitcher

/// Перевод строк интерфейса на английский
@Suite("Локализация интерфейса")
struct LocalizationTests {
    @Test("английский словарь переводит известные строки и не теряет неизвестные")
    func englishDictionary() {
        let previous = L10n.language
        L10n.save(.en)
        defer {
            L10n.save(previous)
        }
        #expect(L10n.t("Настройки") == "Settings")
        #expect(L10n.t("Повторить запрос") == "Replay request")
        #expect(L10n.t("Неизвестная строка") == "Неизвестная строка")
        #expect(L10n.t("Загружено правил: %d") == "Rules loaded: %d")
        #expect(L10n.english.values.allSatisfy { !$0.isEmpty })
    }

    @Test("русский язык возвращает исходные строки")
    func russianKeepsSource() {
        let previous = L10n.language
        L10n.save(.ru)
        defer {
            L10n.save(previous)
        }
        #expect(L10n.t("Настройки") == "Настройки")
    }
}
