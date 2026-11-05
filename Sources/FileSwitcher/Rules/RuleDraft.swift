import Foundation

/// Экранирует спецсимволы регулярного выражения, чтобы вставить адрес как есть
func escapedRegexPattern(_ text: String) -> String {
    let special: Set<Character> = ["\\", ".", "^", "$", "|", "?", "*", "+", "(", ")", "[", "]", "{", "}"]
    var result = ""
    for character in text {
        if special.contains(character) {
            result.append("\\")
        }
        result.append(character)
    }
    return result
}

/// Значение заголовка без учёта регистра его имени
func headerValue(_ headers: [String: String], name: String) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
}

/// Черновик правила подмены из записи журнала: адрес экранирован, тело ответа подставлено
func draftRule(from event: ProxyLogEvent) -> Rule {
    let body = event.responseBodyIsBinary ? "" : event.responseBody
    return Rule(
        id: UUID().uuidString,
        enabled: true,
        urlPattern: escapedRegexPattern(event.url),
        isRegex: true,
        localFilePath: nil,
        responseBody: body.isEmpty ? nil : body,
        contentType: headerValue(event.responseHeaders, name: "content-type")
    )
}
