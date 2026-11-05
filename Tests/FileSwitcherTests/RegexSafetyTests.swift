import Foundation
import Testing
@testable import FileSwitcher

/// Проверка безопасного поднабора регулярных выражений правил
@Suite("Безопасность regex")
struct RegexSafetyTests {
    @Test("разумные шаблоны допустимы")
    func acceptsCommonPatterns() {
        #expect(unsafeRegexReason("^https://example\\.com/api/.*") == nil)
        #expect(unsafeRegexReason("^[^?]*/disk-detail/service/.*") == nil)
        #expect(unsafeRegexReason("^https://[^/]+/api/v\\d+/items(?:/list)?$") == nil)
        #expect(unsafeRegexReason("^https://example\\.com/(a|b)/x") == nil)
        #expect(unsafeRegexReason("^https://example\\.com/(?<id>\\d+)/x") == nil)
        #expect(unsafeRegexReason("^a{2,5}b$") == nil)
    }

    @Test("слишком длинный шаблон отклоняется")
    func rejectsLongPattern() {
        let pattern = String(repeating: "a", count: maxRegexPatternLength + 1)
        #expect(unsafeRegexReason(pattern) == "шаблон длиннее \(maxRegexPatternLength) символов")
    }

    @Test("обратные ссылки отклоняются")
    func rejectsBackReferences() {
        #expect(unsafeRegexReason("^(a)\\1$") == "обратные ссылки не поддерживаются")
        #expect(unsafeRegexReason("^(?<n>a)\\k<n>$") == "обратные ссылки не поддерживаются")
    }

    @Test("lookaround отклоняется")
    func rejectsLookaround() {
        #expect(unsafeRegexReason("^a(?=b)") == "lookaround и специальные группы не поддерживаются")
        #expect(unsafeRegexReason("^(?<!x)a") == "lookaround и специальные группы не поддерживаются")
    }

    @Test("повторяемая группа с alternation отклоняется")
    func rejectsRepeatedAlternationGroup() {
        #expect(unsafeRegexReason("^(a|b)+$") == "повторяемая группа содержит repeat или alternation")
        #expect(unsafeRegexReason("^(a+)+$") == "повторяемая группа содержит repeat или alternation")
    }

    @Test("несколько повторяемых wildcard отклоняются")
    func rejectsMultipleRepeatedWildcards() {
        #expect(unsafeRegexReason(".*.*x") == "несколько повторяемых wildcard не поддерживаются")
        #expect(unsafeRegexReason("a.+b.+c") == "несколько повторяемых wildcard не поддерживаются")
    }

    @Test("ленивый квантификатор не считается вторым повтором")
    func acceptsLazyQuantifier() {
        #expect(unsafeRegexReason("^a.*?b$") == nil)
    }
}
