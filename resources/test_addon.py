"""
Тесты чистой логики addon.py: матчинг правил, подстановка групп regex, редакция заголовков,
применение header-overrides. Запуск: .venv/bin/python3 -m pytest resources/test_addon.py
(нужен pytest — см. requirements-dev.txt).
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import addon  # noqa: E402


def make_switcher(rules):
    rs = addon.ResponseSwitcher()
    rs.rules = rules
    rs.rules_path = "/fake/rules.json"
    return rs


# --- _redact_headers ---

def test_redact_known_secret_headers_case_insensitive():
    out = addon._redact_headers(
        {"Authorization": "Bearer x", "cookie": "sid=1", "X-Api-Key": "k", "Content-Type": "application/json"}
    )
    assert out["Authorization"] == addon.REDACTED_PLACEHOLDER
    assert out["cookie"] == addon.REDACTED_PLACEHOLDER
    assert out["X-Api-Key"] == addon.REDACTED_PLACEHOLDER
    assert out["Content-Type"] == "application/json"


def test_redact_keeps_all_header_names():
    src = {"Authorization": "x", "Accept": "y"}
    assert set(addon._redact_headers(src).keys()) == set(src.keys())


# --- _substitute_groups ---

def test_substitute_groups_replaces_dollar_n_from_match():
    m = re.search(r"/api/(v\d+)/(\w+)", "/api/v3/orders")
    assert addon.ResponseSwitcher._substitute_groups("mock_$1_$2.json", m) == "mock_v3_orders.json"


def test_substitute_groups_missing_group_raises_indexerror():
    # $2 без второй группы в regex — IndexError; вызывающий код в request() это ловит и логирует
    m = re.search(r"/api/(\w+)", "/api/users")
    with __import__("pytest").raises(IndexError):
        addon.ResponseSwitcher._substitute_groups("$1_$2", m)


def test_substitute_groups_empty_optional_group_becomes_empty_string():
    # группа есть в regex, но не совпала (опциональная) — None → ""
    m = re.search(r"/api/(\w+)(/x)?", "/api/users")
    assert addon.ResponseSwitcher._substitute_groups("$1$2", m) == "users"


# --- _find_matching_rule ---

def test_find_matching_rule_exact_url():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": "https://x.com/a", "isRegex": False}])
    rule, matched = rs._find_matching_rule("https://x.com/a")
    assert rule["id"] == "a"
    assert matched is None


def test_find_matching_rule_exact_url_no_partial():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": "https://x.com/a", "isRegex": False}])
    rule, _ = rs._find_matching_rule("https://x.com/a/b")
    assert rule is None


def test_find_matching_rule_regex():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": r"/api/v\d+/items", "isRegex": True}])
    rule, matched = rs._find_matching_rule("https://x.com/api/v2/items?page=1")
    assert rule["id"] == "a"
    assert matched is not None


def test_find_matching_rule_skips_disabled():
    rs = make_switcher([{"id": "a", "enabled": False, "urlPattern": "https://x.com/a", "isRegex": False}])
    assert rs._find_matching_rule("https://x.com/a") == (None, None)


def test_find_matching_rule_skips_empty_pattern():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": "", "isRegex": False}])
    assert rs._find_matching_rule("https://x.com/a") == (None, None)


def test_find_matching_rule_bad_regex_is_skipped_not_raised():
    rs = make_switcher(
        [
            {"id": "bad", "enabled": True, "urlPattern": "[unclosed", "isRegex": True},
            {"id": "good", "enabled": True, "urlPattern": r"/ok", "isRegex": True},
        ]
    )
    rule, _ = rs._find_matching_rule("https://x.com/ok")
    assert rule["id"] == "good"


def test_find_matching_rule_first_match_wins():
    rs = make_switcher(
        [
            {"id": "first", "enabled": True, "urlPattern": r"/api", "isRegex": True},
            {"id": "second", "enabled": True, "urlPattern": r"/api/v2", "isRegex": True},
        ]
    )
    rule, _ = rs._find_matching_rule("https://x.com/api/v2/x")
    assert rule["id"] == "first"


# --- _apply_header_overrides ---

def test_apply_header_overrides_set_and_delete():
    headers = {"X-Old": "keep", "X-Remove": "gone"}
    addon.ResponseSwitcher._apply_header_overrides(
        headers,
        [{"name": "X-New", "value": "added"}, {"name": "X-Remove", "value": ""}, {"name": "", "value": "ignored"}],
    )
    assert headers == {"X-Old": "keep", "X-New": "added"}
