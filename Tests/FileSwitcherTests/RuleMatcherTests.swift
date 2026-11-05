import Foundation
import Testing
@testable import FileSwitcher

/// Матчинг правил и чтение тела подмены
@Suite("Правила: матчинг")
struct RuleMatcherTests {
    /// Кладёт rules.json во временный каталог и отдаёт матчер
    private func makeMatcher(rules: String) throws -> (RuleMatcher, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appendingPathComponent("rules.json")
        try rules.write(to: fileURL, atomically: true, encoding: .utf8)
        let matcher = RuleMatcher(rulesFilePath: fileURL) { _ in }
        return (matcher, fileURL)
    }

    @Test("точное совпадение находит правило, выключенное — нет")
    func exactMatch() throws {
        let (matcher, _) = try makeMatcher(rules: """
        {"rules":[
          {"id":"on","enabled":true,"urlPattern":"https://example.com/a","isRegex":false},
          {"id":"off","enabled":false,"urlPattern":"https://example.com/b","isRegex":false}
        ]}
        """)
        #expect(matcher.match("https://example.com/a")?.rule.id == "on")
        #expect(matcher.match("https://example.com/b") == nil)
    }

    @Test("regex с группами подставляет $1 в путь файла")
    func regexGroupsSubstitution() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: directory)
        }
        let replacementURL = directory.appendingPathComponent("42.json")
        try "{\"id\":42}".write(to: replacementURL, atomically: true, encoding: .utf8)
        let rules = """
        {"rules":[{"id":"rx","enabled":true,"urlPattern":"^https://example\\\\.com/api/(\\\\d+)$","isRegex":true,
        "localFilePath":"\(directory.path)/$1.json"}]}
        """
        let rulesURL = directory.appendingPathComponent("rules.json")
        try rules.write(to: rulesURL, atomically: true, encoding: .utf8)
        let matcher = RuleMatcher(rulesFilePath: rulesURL) { _ in }

        let match = try #require(matcher.match("https://example.com/api/42"))
        #expect(match.groups?[1] == "42")
        let body = try #require(try matcher.replacementBody(for: match))
        #expect(String(decoding: body.body, as: UTF8.self) == "{\"id\":42}")
        #expect(body.contentType == "application/json")
        #expect(body.file == replacementURL.path)
    }

    @Test("инлайн-тело приоритетнее файла")
    func inlineBodyWins() throws {
        let (matcher, _) = try makeMatcher(rules: """
        {"rules":[{"id":"inline","enabled":true,"urlPattern":"https://example.com/inline","isRegex":false,
        "responseBody":"{\\"ok\\":true}","contentType":"application/json"}]}
        """)
        let match = try #require(matcher.match("https://example.com/inline"))
        let body = try #require(try matcher.replacementBody(for: match))
        #expect(body.file.isEmpty)
        #expect(String(decoding: body.body, as: UTF8.self) == "{\"ok\":true}")
    }

    @Test("небезопасный regex не попадает в индекс")
    func unsafeRegexSkipped() throws {
        let (matcher, _) = try makeMatcher(rules: """
        {"rules":[{"id":"unsafe","enabled":true,"urlPattern":"^(a|b)+$","isRegex":true}]}
        """)
        #expect(matcher.match("https://example.com/") == nil)
    }

    @Test("подстановка не выпускает путь за базовый каталог")
    func substitutionCannotEscapeBaseDirectory() {
        #expect(throws: RuleValidationError.self) {
            try resolveSubstitutedPath("/base/$1/file.json", groups: ["x", "../secret"])
        }
        #expect(throws: RuleValidationError.self) {
            try resolveSubstitutedPath("/base/$1/file.json", groups: ["x", "/etc/passwd"])
        }
    }
}
