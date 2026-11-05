import Foundation

/// Потолок длины регулярного выражения в правиле
let maxRegexPatternLength = 2_048

/// Состояние группы внутри шаблона: был ли в ней repeat или alternation
private struct RegexGroupFrame {
    var hasRepeat = false
    var hasAlternation = false
}

/// Атом шаблона: обычный символ (с признаком wildcard) или только что закрытая группа
private enum RegexAtom {
    case simple(isWildcard: Bool)
    case group(RegexGroupFrame)
}

/// Проверяет, что regex входит в безопасный поднабор без катастрофического backtracking.
/// nil — шаблон допустим, иначе причина отказа.
func unsafeRegexReason(_ pattern: String) -> String? {
    if pattern.count > maxRegexPatternLength {
        return "шаблон длиннее \(maxRegexPatternLength) символов"
    }

    let characters = Array(pattern)
    var frames = [RegexGroupFrame()]
    var lastAtom: RegexAtom?
    var lastWasQuantifier = false
    var repeatedWildcards = 0
    var index = 0

    while index < characters.count {
        let character = characters[index]

        if character == "\\" {
            guard index + 1 < characters.count else {
                break
            }
            let escaped = characters[index + 1]
            if ("1"..."9").contains(escaped) || escaped == "k" {
                return "обратные ссылки не поддерживаются"
            }
            lastAtom = .simple(isWildcard: false)
            lastWasQuantifier = false
            index += 2
            continue
        }

        if character == "[" {
            index += 1
            while index < characters.count {
                if characters[index] == "\\" {
                    index += 2
                    continue
                }
                if characters[index] == "]" {
                    index += 1
                    break
                }
                index += 1
            }
            lastAtom = .simple(isWildcard: false)
            lastWasQuantifier = false
            continue
        }

        if character == "(" {
            if matchesPrefix(characters, at: index, prefix: "(?:") {
                index += 3
            } else if matchesPrefix(characters, at: index, prefix: "(?<"), !isLookbehind(characters, at: index) {
                guard let nameEnd = characters[(index + 3)...].firstIndex(of: ">") else {
                    break
                }
                index = nameEnd + 1
            } else if matchesPrefix(characters, at: index, prefix: "(?") {
                return "lookaround и специальные группы не поддерживаются"
            } else {
                index += 1
            }
            frames.append(RegexGroupFrame())
            lastAtom = nil
            lastWasQuantifier = false
            continue
        }

        if character == ")" {
            if frames.count == 1 {
                break
            }
            let frame = frames.removeLast()
            let parent = frames.count - 1
            frames[parent].hasRepeat = frames[parent].hasRepeat || frame.hasRepeat
            frames[parent].hasAlternation = frames[parent].hasAlternation || frame.hasAlternation
            lastAtom = .group(frame)
            lastWasQuantifier = false
            index += 1
            continue
        }

        if character == "|" {
            frames[frames.count - 1].hasAlternation = true
            lastAtom = nil
            lastWasQuantifier = false
            index += 1
            continue
        }

        var quantifierEnd: Int?
        if character == "*" || character == "+" || character == "?" {
            // ленивый квантификатор (`*?`, `+?`) — продолжение предыдущего, а не новый repeat
            if character == "?", lastWasQuantifier {
                lastWasQuantifier = false
                index += 1
                continue
            }
            quantifierEnd = index + 1
        } else if character == "{", let end = bracedQuantifierEnd(characters, from: index) {
            quantifierEnd = end
        }

        if let quantifierEnd, let lastAtom {
            if case let .group(frame) = lastAtom, frame.hasRepeat || frame.hasAlternation {
                return "повторяемая группа содержит repeat или alternation"
            }
            frames[frames.count - 1].hasRepeat = true
            if case let .simple(isWildcard) = lastAtom, isWildcard {
                repeatedWildcards += 1
                if repeatedWildcards > 1 {
                    return "несколько повторяемых wildcard не поддерживаются"
                }
            }
            lastWasQuantifier = true
            index = quantifierEnd
            continue
        }

        lastAtom = (character == "^" || character == "$") ? nil : .simple(isWildcard: character == ".")
        lastWasQuantifier = false
        index += 1
    }

    return nil
}

/// Начинается ли шаблон в позиции с указанного префикса
private func matchesPrefix(_ characters: [Character], at index: Int, prefix: String) -> Bool {
    let prefixCharacters = Array(prefix)
    guard index + prefixCharacters.count <= characters.count else {
        return false
    }
    return Array(characters[index..<(index + prefixCharacters.count)]) == prefixCharacters
}

/// `(?<=` и `(?<!` — lookbehind, остальные `(?<` открывают именованную группу
private func isLookbehind(_ characters: [Character], at index: Int) -> Bool {
    guard index + 3 < characters.count else {
        return false
    }
    return characters[index + 3] == "=" || characters[index + 3] == "!"
}

/// Позиция после квантификатора вида `{2}` или `{2,5}`; nil — это не квантификатор
private func bracedQuantifierEnd(_ characters: [Character], from index: Int) -> Int? {
    var cursor = index + 1
    var hasDigits = false
    while cursor < characters.count, characters[cursor].isNumber {
        cursor += 1
        hasDigits = true
    }
    guard hasDigits else {
        return nil
    }
    if cursor < characters.count, characters[cursor] == "," {
        cursor += 1
        while cursor < characters.count, characters[cursor].isNumber {
            cursor += 1
        }
    }
    guard cursor < characters.count, characters[cursor] == "}" else {
        return nil
    }
    return cursor + 1
}
