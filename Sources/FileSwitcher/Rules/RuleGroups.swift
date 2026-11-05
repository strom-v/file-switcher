import Foundation

/// Ключ, под которым в интерфейсе показываются правила без явной группы
let otherGroupKey = ""

/// Ключ группы правила — нормализует nil и пустую строку к otherGroupKey
func groupKey(of rule: Rule) -> String {
    guard let group = rule.group, !group.isEmpty else {
        return otherGroupKey
    }
    return group
}

/// Сравнивает названия групп: латинские идут перед кириллическими, внутри каждой части по алфавиту
func compareGroupNames(_ first: String, _ second: String) -> Bool {
    let firstIsCyrillic = isCyrillic(first)
    let secondIsCyrillic = isCyrillic(second)
    if firstIsCyrillic != secondIsCyrillic {
        return secondIsCyrillic
    }
    return first.localizedStandardCompare(second) == .orderedAscending
}

/// Есть ли в названии кириллица
func isCyrillic(_ text: String) -> Bool {
    text.unicodeScalars.contains { scalar in
        (0x0400...0x04FF).contains(scalar.value) || scalar == "ё" || scalar == "Ё"
    }
}

/// Репозиторий из пути подмены — сегмент после ".../projects/<организация>/<репозиторий>/..."
func extractRepoFromPath(_ localFilePath: String?) -> String? {
    guard let localFilePath, let regex = try? NSRegularExpression(pattern: "/projects/[^/]+/([^/]+)/") else {
        return nil
    }
    let range = NSRange(localFilePath.startIndex..., in: localFilePath)
    guard let match = regex.firstMatch(in: localFilePath, range: range), match.numberOfRanges > 1,
          let repoRange = Range(match.range(at: 1), in: localFilePath) else {
        return nil
    }
    return String(localFilePath[repoRange])
}

/// Группа правила при первой миграции: из пути, иначе "остальные"
func initialGroupForRule(_ rule: Rule) -> String {
    extractRepoFromPath(rule.localFilePath) ?? otherGroupKey
}

/// Проставляет группу правилам, где её нет; nil — менять нечего
func rulesWithGroups(_ rules: [Rule]) -> [Rule]? {
    guard rules.contains(where: { $0.group == nil }) else {
        return nil
    }
    var result: [Rule] = []
    for rule in rules {
        guard rule.group == nil else {
            result.append(rule)
            continue
        }
        var migrated = rule
        migrated.group = initialGroupForRule(rule)
        result.append(migrated)
    }
    return result
}
