import Foundation
import Testing
@testable import FileSwitcher

/// Группы правил и валидация правила
@Suite("Правила: группы и проверки")
struct RuleGroupsValidationTests {
    private func makeRule(
        id: String = "r1",
        pattern: String = "^https://example\\.com/.*",
        isRegex: Bool = true,
        group: String? = nil,
        localFilePath: String? = nil
    ) -> Rule {
        Rule(
            id: id,
            enabled: true,
            urlPattern: pattern,
            isRegex: isRegex,
            group: group,
            localFilePath: localFilePath
        )
    }

    @Test("ключ группы нормализует nil и пустую строку")
    func groupKeyNormalizes() {
        #expect(groupKey(of: makeRule(group: nil)) == otherGroupKey)
        #expect(groupKey(of: makeRule(group: "")) == otherGroupKey)
        #expect(groupKey(of: makeRule(group: "saby")) == "saby")
    }

    @Test("латиница идёт перед кириллицей")
    func compareGroupNamesOrdersCyrillicLast() {
        #expect(compareGroupNames("alpha", "beta"))
        #expect(!compareGroupNames("beta", "alpha"))
        #expect(compareGroupNames("alpha", "сэр"))
        #expect(!compareGroupNames("сэр", "alpha"))
    }

    @Test("репозиторий берётся из пути подмены")
    func extractRepoFromPathCases() {
        #expect(extractRepoFromPath("/Users/dev/projects/saby/disk-detail-3/file.json") == "disk-detail-3")
        #expect(extractRepoFromPath("/Users/dev/other/file.json") == nil)
        #expect(extractRepoFromPath(nil) == nil)
    }

    @Test("миграция групп проставляет группу по пути один раз")
    func migrationAssignsGroups() throws {
        let rules = [
            makeRule(id: "a", localFilePath: "/x/projects/saby/repo-one/file.json"),
            makeRule(id: "b"),
            makeRule(id: "c", group: "manual")
        ]
        let migrated = try #require(rulesWithGroups(rules))
        #expect(migrated[0].group == "repo-one")
        #expect(migrated[1].group == otherGroupKey)
        #expect(migrated[2].group == "manual")
        #expect(rulesWithGroups(migrated) == nil)
    }

    @Test("пустой паттерн и небезопасный regex отклоняются")
    func validationRejectsBadRules() {
        #expect(throws: RuleValidationError.self) {
            try validateRule(makeRule(pattern: "   "))
        }
        #expect(throws: RuleValidationError.self) {
            try validateRule(makeRule(pattern: "^(a|b)+$"))
        }
        #expect(throws: RuleValidationError.self) {
            try validateRule(makeRule(pattern: "^(a$"))
        }
    }

    @Test("диапазоны задержки и статуса проверяются")
    func validationChecksRanges() {
        var rule = makeRule()
        rule.delayMs = 60_001
        #expect(throws: RuleValidationError.self) {
            try validateRule(rule)
        }
        var statusRule = makeRule()
        statusRule.statusCodeOverride = 42
        #expect(throws: RuleValidationError.self) {
            try validateRule(statusRule)
        }
        var headerRule = makeRule()
        headerRule.requestHeaderOverrides = [HeaderOverride(name: "  ", value: "x")]
        #expect(throws: RuleValidationError.self) {
            try validateRule(headerRule)
        }
    }

    @Test("JSON-тело с тип-контентом json обязано быть валидным")
    func validationChecksJSONBody() {
        var rule = makeRule()
        rule.contentType = "application/json; charset=utf-8"
        rule.responseBody = "{ not json"
        #expect(throws: RuleValidationError.self) {
            try validateRule(rule)
        }
        rule.responseBody = "{\"ok\":true}"
        #expect(throws: Never.self) {
            try validateRule(rule)
        }
    }
}
