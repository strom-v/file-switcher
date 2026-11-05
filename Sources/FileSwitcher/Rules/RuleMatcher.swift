import Foundation

/// URL длиннее этого не прогоняем через regex — ограничивает время матчинга
let maxRegexURLLength = 8_192
/// Файл-подмена читается целиком в память, выше этого размера отклоняется
let maxReplacementFileBytes = 16 * 1024 * 1024
/// rules.json перечитывается по mtime, но не чаще раза в этот интервал
private let rulesMtimeCheckInterval: TimeInterval = 1

/// Тип содержимого по расширению файла подмены
func guessContentType(_ path: String) -> String {
    let mimeTypes: [String: String] = [
        ".css": "text/css",
        ".csv": "text/csv",
        ".gif": "image/gif",
        ".htm": "text/html",
        ".html": "text/html",
        ".ico": "image/vnd.microsoft.icon",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".js": "text/javascript",
        ".json": "application/json",
        ".map": "application/json",
        ".mjs": "text/javascript",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".txt": "text/plain",
        ".wasm": "application/wasm",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".xml": "application/xml"
    ]
    let ext = ("." + (path as NSString).pathExtension).lowercased()
    return mimeTypes[ext] ?? "application/octet-stream"
}

/// Подставляет $N из групп regex-совпадения (как в Fiddler AutoResponder)
func substituteGroups(_ path: String, groups: [String?]) throws -> String {
    var result = ""
    var index = path.startIndex
    while index < path.endIndex {
        guard path[index] == "$" else {
            result.append(path[index])
            index = path.index(after: index)
            continue
        }
        var cursor = path.index(after: index)
        var digits = ""
        while cursor < path.endIndex, path[cursor].isNumber {
            digits.append(path[cursor])
            cursor = path.index(after: cursor)
        }
        guard let group = Int(digits) else {
            result.append(path[index])
            index = path.index(after: index)
            continue
        }
        guard group < groups.count else {
            throw RuleValidationError(message: "в regex нет группы $\(digits)")
        }
        result += groups[group] ?? ""
        index = cursor
    }
    return result
}

/// Подставляет группы в localFilePath, не выпуская результат за каталог до первой $N
func resolveSubstitutedPath(_ path: String, groups: [String?]) throws -> String {
    let characters = Array(path)
    guard let firstReference = characters.firstIndex(of: "$") else {
        return try realPath(path)
    }
    // каталог — всё до последнего разделителя перед $N
    let trustedPrefix = String(characters[0..<firstReference])
    guard let lastSeparator = trustedPrefix.lastIndex(of: "/") else {
        throw RuleValidationError(message: "до первой $N-подстановки не задан базовый каталог")
    }
    let baseDirectory = lastSeparator == trustedPrefix.startIndex ? "/" : String(trustedPrefix[..<lastSeparator])

    try validateGroupCaptures(characters, groups: groups)
    let resolvedBase = try realPath(baseDirectory)
    let resolvedPath = try realPath(try substituteGroups(path, groups: groups))
    let baseURL = URL(fileURLWithPath: resolvedBase, isDirectory: true).standardizedFileURL
    let pathURL = URL(fileURLWithPath: resolvedPath).standardizedFileURL
    let fromBase = relativePath(from: baseURL.path, to: pathURL.path)
    if fromBase.hasPrefix("..") || fromBase.hasPrefix("/") {
        throw RuleValidationError(message: "результирующий путь выходит за базовый каталог")
    }
    return resolvedPath
}

/// Проверяет, что подставляемые значения не абсолютные и не содержат ".."
private func validateGroupCaptures(_ characters: [Character], groups: [String?]) throws {
    var index = 0
    while index < characters.count {
        guard characters[index] == "$" else {
            index += 1
            continue
        }
        var cursor = index + 1
        var digits = ""
        while cursor < characters.count, characters[cursor].isNumber {
            digits.append(characters[cursor])
            cursor += 1
        }
        guard let group = Int(digits) else {
            index += 1
            continue
        }
        let capture = (groups[safe: group] ?? nil) ?? ""
        if capture.hasPrefix("/") || capture.hasPrefix("\\") || capture.split(whereSeparator: { $0 == "/" || $0 == "\\" }).contains("..") {
            throw RuleValidationError(message: "небезопасное значение $\(digits)")
        }
        index = cursor
    }
}

/// Путь после раскрытия символических ссылок
private func realPath(_ path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    guard FileManager.default.fileExists(atPath: url.path) else {
        return url.standardizedFileURL.path
    }
    return url.resolvingSymlinksInPath().path
}

/// Относительный путь от базового каталога
private func relativePath(from base: String, to path: String) -> String {
    let baseComponents = base.split(separator: "/")
    let pathComponents = path.split(separator: "/")
    var common = 0
    while common < baseComponents.count, common < pathComponents.count, baseComponents[common] == pathComponents[common] {
        common += 1
    }
    var components: [String] = Array(repeating: "..", count: baseComponents.count - common)
    components.append(contentsOf: pathComponents[common...].map(String.init))
    return components.joined(separator: "/")
}

extension Array {
    /// Элемент по индексу или nil, если индекс вне границ
    subscript(safe index: Int) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}

/// Индекс правил для горячего пути прокси: точные URL по хешу, regex предкомпилированы
/// и проверены на безопасность. Файл перечитывается по mtime, поэтому ручные правки
/// rules.json подхватываются так же, как сохранения из интерфейса.
final class RuleMatcher: RuleEngine, @unchecked Sendable {
    private struct RegexRule {
        var rule: Rule
        var regex: NSRegularExpression
    }

    private struct CachedBody {
        var modified: Date
        var size: Int
        var body: Data
    }

    private let rulesFilePath: URL
    private let warn: @Sendable (String) -> Void
    private let lock = NSLock()

    private var exactRules: [String: Rule] = [:]
    private var regexRules: [RegexRule] = []
    private var lastModified: Date?
    private var lastModifiedCheck = Date.distantPast
    private var lastReloadError: String?
    private var replacementCache: [String: CachedBody] = [:]

    init(rulesFilePath: URL, warn: @escaping @Sendable (String) -> Void) {
        self.rulesFilePath = rulesFilePath
        self.warn = warn
        reload(context: "не удалось прочитать rules.json при старте")
    }

    /// Находит первое сработавшее правило для URL
    func match(_ url: String) -> RuleMatch? {
        reloadIfChanged()
        lock.lock()
        defer {
            lock.unlock()
        }
        if let exact = exactRules[url] {
            RuleHitCounter.shared.register(ruleId: exact.id)
            return RuleMatch(rule: exact, groups: nil)
        }
        guard url.count <= maxRegexURLLength else {
            return nil
        }
        let range = NSRange(url.startIndex..., in: url)
        for entry in regexRules {
            guard let match = entry.regex.firstMatch(in: url, range: range) else {
                continue
            }
            RuleHitCounter.shared.register(ruleId: entry.rule.id)
            return RuleMatch(rule: entry.rule, groups: captureGroups(of: match, in: url))
        }
        return nil
    }

    /// Тело подмены из правила: inline-тело приоритетнее файла
    func replacementBody(for match: RuleMatch) throws -> ReplacementBody? {
        let rule = match.rule
        if let inline = rule.responseBody, !inline.isEmpty {
            return ReplacementBody(
                body: Data(inline.utf8),
                contentType: rule.contentType ?? "application/json; charset=utf-8",
                file: ""
            )
        }
        guard let localFilePath = rule.localFilePath, !localFilePath.isEmpty else {
            return nil
        }
        let path: String
        if let groups = match.groups {
            path = try resolveSubstitutedPath(localFilePath, groups: groups)
        } else {
            path = try realPath(localFilePath)
        }
        let body = try readReplacementFile(path)
        return ReplacementBody(body: body, contentType: rule.contentType ?? guessContentType(path), file: path)
    }

    /// Перечитывает файл правил, но не чаще раза в секунду
    private func reloadIfChanged() {
        let now = Date()
        lock.lock()
        let sinceLastCheck = now.timeIntervalSince(lastModifiedCheck)
        guard sinceLastCheck >= rulesMtimeCheckInterval else {
            lock.unlock()
            return
        }
        lastModifiedCheck = now
        let knownModified = lastModified
        lock.unlock()

        let currentModified: Date
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: rulesFilePath.path)
            currentModified = attributes[.modificationDate] as? Date ?? .distantPast
        } catch {
            warn("rules.json недоступен: \(error.localizedDescription)")
            return
        }
        if currentModified == knownModified {
            return
        }
        // при неудаче остаются прежние правила — матчим по последнему валидному набору
        reload(context: "не удалось перечитать rules.json")
    }

    /// Читает файл правил и пересобирает индекс
    private func reload(context: String) {
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: rulesFilePath.path)
            let modified = attributes[.modificationDate] as? Date ?? .distantPast
            let data = try Data(contentsOf: rulesFilePath)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw JsonFileError.notAnObject
            }
            guard let rawRules = object["rules"] as? [[String: Any]] else {
                throw JsonFileError.rulesNotArray
            }
            let rules = try Self.decodeRules(rawRules)
            lock.lock()
            lastModified = modified
            let previousError = lastReloadError
            lastReloadError = nil
            lock.unlock()
            rebuildIndex(rules)
            if previousError != nil {
                warn("rules.json снова читается, правила обновлены")
            }
        } catch {
            let message = error.localizedDescription
            lock.lock()
            let isNewError = message != lastReloadError
            lastReloadError = message
            lock.unlock()
            if isNewError {
                warn("\(context): \(message). Прежние правила остаются активными.")
            }
        }
    }

    /// Разбирает правила из JSON: с проверкой неизвестных полей и обязательных ключей
    private static func decodeRules(_ rawRules: [[String: Any]]) throws -> [Rule] {
        var rules: [Rule] = []
        for rawRule in rawRules {
            let id = rawRule["id"] as? String ?? "(без id)"
            for key in ["id", "enabled", "urlPattern", "isRegex"] where rawRule[key] == nil {
                throw RuleValidationError(message: "Правило \(id): отсутствует обязательное поле \"\(key)\"")
            }
            try validateRuleKeys(rawRule, id: id)
            let data = try JSONSerialization.data(withJSONObject: rawRule)
            rules.append(try JSONDecoder().decode(Rule.self, from: data))
        }
        return rules
    }

    /// Пересобирает индекс: точные URL и предкомпилированные безопасные regex
    private func rebuildIndex(_ rules: [Rule]) {
        var exact: [String: Rule] = [:]
        var compiled: [RegexRule] = []
        for rule in rules {
            guard rule.enabled else {
                continue
            }
            guard !rule.urlPattern.isEmpty else {
                warn("правило \(rule.id) пропущено: пустой urlPattern")
                continue
            }
            guard rule.isRegex else {
                // первое правило с данным точным URL выигрывает — как и при линейном проходе
                if exact[rule.urlPattern] == nil {
                    exact[rule.urlPattern] = rule
                }
                continue
            }
            if let unsafeReason = unsafeRegexReason(rule.urlPattern) {
                warn("небезопасный regex в правиле \(rule.id): \(unsafeReason)")
                continue
            }
            do {
                compiled.append(RegexRule(rule: rule, regex: try NSRegularExpression(pattern: rule.urlPattern)))
            } catch {
                warn("некорректный regex в правиле \(rule.id): \(error.localizedDescription)")
            }
        }
        lock.lock()
        exactRules = exact
        regexRules = compiled
        lock.unlock()
    }

    /// Читает файл подмены с лимитом размера и кэшем по mtime
    private func readReplacementFile(_ path: String) throws -> Data {
        let attributes = try FileManager.default.attributesOfItem(atPath: path)
        let modified = attributes[.modificationDate] as? Date ?? .distantPast
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard size <= maxReplacementFileBytes else {
            throw RuleValidationError(message: "файл \(size) Б превышает лимит \(maxReplacementFileBytes) Б")
        }
        lock.lock()
        let cached = replacementCache[path]
        lock.unlock()
        if let cached, cached.modified == modified, cached.size == size {
            return cached.body
        }
        let body = try Data(contentsOf: URL(fileURLWithPath: path))
        lock.lock()
        replacementCache[path] = CachedBody(modified: modified, size: size, body: body)
        lock.unlock()
        return body
    }

    /// Группы совпадения в порядке $0, $1, ... (nil — группа не участвовала)
    private func captureGroups(of match: NSTextCheckingResult, in url: String) -> [String?] {
        var groups: [String?] = []
        for index in 0..<match.numberOfRanges {
            guard let range = Range(match.range(at: index), in: url) else {
                groups.append(nil)
                continue
            }
            groups.append(String(url[range]))
        }
        return groups
    }
}
