import Foundation

/// Допустимые ключи правила — опечатка в rules.json должна быть видна, а не потеряна
let allowedRuleKeys: Set<String> = [
    "id",
    "enabled",
    "urlPattern",
    "isRegex",
    "group",
    "localFilePath",
    "responseBody",
    "contentType",
    "requestHeaderOverrides",
    "responseHeaderOverrides",
    "delayMs",
    "statusCodeOverride"
]

/// Ошибка проверки правила
struct RuleValidationError: LocalizedError {
    let message: String

    var errorDescription: String? {
        message
    }
}

/// Проверяет правило целиком: иначе оно молча ведёт себя не так, как написано
func validateRule(_ rule: Rule) throws {
    if rule.urlPattern.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        throw RuleValidationError(message: "Правило \(rule.id): пустой URL-паттерн")
    }
    if rule.isRegex {
        do {
            _ = try NSRegularExpression(pattern: rule.urlPattern)
        } catch {
            throw RuleValidationError(message: "Правило \(rule.id): некорректный regex \"\(rule.urlPattern)\" - \(error.localizedDescription)")
        }
        if let unsafeReason = unsafeRegexReason(rule.urlPattern) {
            throw RuleValidationError(message: "Правило \(rule.id): regex не поддерживается прокси - \(unsafeReason)")
        }
    }
    if let body = rule.responseBody, !body.isEmpty, rule.contentType?.contains("json") == true {
        do {
            _ = try JSONSerialization.jsonObject(with: Data(body.utf8), options: [.fragmentsAllowed])
        } catch {
            throw RuleValidationError(message: "Правило \(rule.id): тело ответа не является валидным JSON - \(error.localizedDescription)")
        }
    }
    if let delay = rule.delayMs, delay < 0 || delay > 60_000 {
        throw RuleValidationError(message: "Правило \(rule.id): delayMs должен быть числом от 0 до 60000 мс")
    }
    if let statusCode = rule.statusCodeOverride, statusCode < 100 || statusCode > 599 {
        throw RuleValidationError(message: "Правило \(rule.id): statusCodeOverride должен быть целым числом от 100 до 599")
    }
    for (key, overrides) in [
        ("requestHeaderOverrides", rule.requestHeaderOverrides),
        ("responseHeaderOverrides", rule.responseHeaderOverrides)
    ] {
        for override in overrides ?? [] where override.name.trimmingCharacters(in: .whitespaces).isEmpty {
            throw RuleValidationError(message: "Правило \(rule.id): в \(key) есть заголовок с пустым именем")
        }
    }
}

/// Проверяет, что в объекте правила нет неизвестных полей
func validateRuleKeys(_ object: [String: Any], id: String) throws {
    for key in object.keys where !allowedRuleKeys.contains(key) {
        throw RuleValidationError(message: "Правило \(id): неизвестное поле \"\(key)\" (опечатка?)")
    }
}
