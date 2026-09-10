"""
Тесты чистой логики addon.py: матчинг правил, подстановка групп regex, редакция заголовков,
применение header-overrides. Запуск: .venv/bin/python3 -m pytest resources/test_addon.py
(нужен pytest — см. requirements-dev.txt).
"""
import json
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).parent))

import addon  # noqa: E402


def make_switcher(rules):
    rs = addon.ResponseSwitcher()
    rs.rules_path = "/fake/rules.json"
    rs._exact_rules = {}
    rs._regex_rules = []
    rs._replacement_cache = {}
    rs.rules = rules
    rs._rebuild_index()
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


def test_redacted_headers_match_shared_contract():
    # src/shared/redactedHeaders.ts — единый источник для Python-аддона и replay в main-процессе
    shared = (Path(__file__).parent.parent / "src" / "shared" / "redactedHeaders.ts").read_text()
    names_block = re.search(r"REDACTED_HEADER_NAMES\s*=\s*\[(.*?)\]", shared, re.DOTALL).group(1)
    shared_names = set(re.findall(r"['\"]([a-z0-9-]+)['\"]", names_block))
    assert shared_names == set(addon.REDACTED_HEADERS)

    placeholder = re.search(r"REDACTED_HEADER_PLACEHOLDER\s*=\s*'([^']+)'", shared).group(1)
    assert placeholder == addon.REDACTED_PLACEHOLDER


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


def test_resolve_substituted_path_allows_nested_relative_capture(tmp_path):
    base = tmp_path / "fixtures"
    matched = re.search(r"/files/(.+)", "/files/api/users.json")

    resolved = addon.ResponseSwitcher._resolve_substituted_path(str(base / "$1"), matched)

    assert resolved == os.path.realpath(base / "api/users.json")


def test_resolve_substituted_path_rejects_parent_traversal(tmp_path):
    matched = re.search(r"/files/(.+)", "/files/../secret.txt")

    with __import__("pytest").raises(ValueError):
        addon.ResponseSwitcher._resolve_substituted_path(str(tmp_path / "fixtures" / "$1"), matched)


def test_resolve_substituted_path_rejects_absolute_capture(tmp_path):
    matched = re.search(r"/files/(.+)", "/files//etc/passwd")

    with __import__("pytest").raises(ValueError):
        addon.ResponseSwitcher._resolve_substituted_path(str(tmp_path / "fixtures" / "$1"), matched)


def test_resolve_substituted_path_rejects_symlink_escape(tmp_path):
    base = tmp_path / "fixtures"
    outside = tmp_path / "outside"
    base.mkdir()
    outside.mkdir()
    (base / "link").symlink_to(outside, target_is_directory=True)
    matched = re.search(r"/files/(.+)", "/files/link/secret.txt")

    with __import__("pytest").raises(ValueError):
        addon.ResponseSwitcher._resolve_substituted_path(str(base / "$1"), matched)


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


def test_find_matching_rule_regex_keeps_common_captures_and_classes():
    rs = make_switcher(
        [{"id": "a", "enabled": True, "urlPattern": r"^https://x\.com/api/(v\d+)/(items|users)$", "isRegex": True}]
    )

    rule, matched = rs._find_matching_rule("https://x.com/api/v2/items")

    assert rule["id"] == "a"
    assert matched.groups() == ("v2", "items")


def test_find_matching_rule_rejects_nested_quantifiers():
    rs = make_switcher(
        [
            {"id": "unsafe", "enabled": True, "urlPattern": r"^(a+)+$", "isRegex": True},
            {"id": "good", "enabled": True, "urlPattern": r"/ok$", "isRegex": True},
        ]
    )

    rule, _ = rs._find_matching_rule("https://x.com/ok")

    assert rule["id"] == "good"


def test_find_matching_rule_rejects_quantified_ambiguous_alternation():
    rs = make_switcher([{"id": "unsafe", "enabled": True, "urlPattern": r"^(a|aa)+$", "isRegex": True}])

    assert rs._find_matching_rule("a" * 100 + "!") == (None, None)


def test_find_matching_rule_skips_regex_for_oversized_url():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": r"/ok$", "isRegex": True}])

    assert rs._find_matching_rule("x" * addon.MAX_REGEX_URL_LENGTH + "/ok") == (None, None)


def test_find_matching_rule_rejects_oversized_pattern():
    rs = make_switcher(
        [{"id": "a", "enabled": True, "urlPattern": "a" * (addon.MAX_REGEX_PATTERN_LENGTH + 1), "isRegex": True}]
    )

    assert rs._find_matching_rule("a") == (None, None)


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


def test_index_recompiles_regex_once_and_reuses_it():
    rs = make_switcher([{"id": "a", "enabled": True, "urlPattern": r"/api/(\d+)$", "isRegex": True}])
    first_compiled = rs._regex_rules[0][1]
    # повторный матчинг не должен пересобирать индекс
    rs._find_matching_rule("https://x.com/api/1")
    assert rs._regex_rules[0][1] is first_compiled


def test_index_drops_disabled_and_unsafe_rules():
    rs = make_switcher(
        [
            {"id": "off", "enabled": False, "urlPattern": "https://x.com/off", "isRegex": False},
            {"id": "unsafe", "enabled": True, "urlPattern": r"^(a+)+$", "isRegex": True},
            {"id": "ok", "enabled": True, "urlPattern": "https://x.com/ok", "isRegex": False},
        ]
    )
    assert set(rs._exact_rules) == {"https://x.com/ok"}
    assert rs._regex_rules == []


# --- _read_replacement_file ---

def _run(coro):
    return __import__("asyncio").new_event_loop().run_until_complete(coro)


def test_read_replacement_file_caches_by_mtime(tmp_path):
    rs = make_switcher([])
    target = tmp_path / "mock.json"
    target.write_bytes(b'{"a":1}')

    first = _run(rs._read_replacement_file(str(target)))
    assert first == b'{"a":1}'
    assert str(target) in rs._replacement_cache

    # тот же неизменный файл — отдаётся из кэша тот же объект bytes
    second = _run(rs._read_replacement_file(str(target)))
    assert second is first


def test_read_replacement_file_rejects_oversized(tmp_path):
    rs = make_switcher([])
    target = tmp_path / "big.bin"
    target.write_bytes(b"x" * (addon.MAX_REPLACEMENT_FILE_BYTES + 1))

    with __import__("pytest").raises(ValueError):
        _run(rs._read_replacement_file(str(target)))


# --- _apply_header_overrides ---

def test_apply_header_overrides_set_and_delete():
    headers = {"X-Old": "keep", "X-Remove": "gone"}
    addon.ResponseSwitcher._apply_header_overrides(
        headers,
        [{"name": "X-New", "value": "added"}, {"name": "X-Remove", "value": ""}, {"name": "", "value": "ignored"}],
    )
    assert headers == {"X-Old": "keep", "X-New": "added"}


# --- bounded traffic logging ---

def test_capture_body_truncates_before_decoding():
    raw = b"a" * (addon.BODY_CAPTURE_LIMIT_BYTES + 100)

    body, is_binary, is_truncated = addon.ResponseSwitcher._capture_body(raw)

    assert body == "a" * addon.BODY_CAPTURE_LIMIT_BYTES
    assert is_binary is False
    assert is_truncated is True


def test_capture_body_omits_binary_content():
    body, is_binary, is_truncated = addon.ResponseSwitcher._capture_body(b"prefix\xffsecret")

    assert body == ""
    assert is_binary is True
    assert is_truncated is False


def test_serialize_log_entry_enforces_stdout_record_limit():
    entry = {
        "event": "passed",
        "url": "https://x.test/" + "u" * (addon.MAX_LOG_RECORD_BYTES * 2),
        "file": "",
        "method": "GET",
        "statusCode": 200,
        "requestHeaders": {"X-Large": "h" * addon.MAX_LOG_RECORD_BYTES},
        "responseHeaders": {},
        "responseSize": 1,
        "ts": 1.0,
        "requestBody": "\x00" * addon.BODY_CAPTURE_LIMIT_BYTES,
        "requestBodyIsBinary": False,
        "requestBodySize": addon.BODY_CAPTURE_LIMIT_BYTES,
        "requestBodyTruncated": False,
        "responseBody": "\x00" * addon.BODY_CAPTURE_LIMIT_BYTES,
        "responseBodyIsBinary": False,
        "responseBodyTruncated": False,
    }

    serialized = addon.ResponseSwitcher._serialize_log_entry(entry)

    assert len(serialized.encode("utf-8")) <= addon.MAX_LOG_RECORD_BYTES
    assert json.loads(serialized)["requestBodyTruncated"] is True


def test_response_logs_body_limits_and_binary_metadata(capsys):
    rs = make_switcher([])
    flow = SimpleNamespace(
        metadata={},
        request=SimpleNamespace(
            pretty_url="https://x.test/upload",
            method="POST",
            headers={},
            raw_content=b"a" * (addon.BODY_CAPTURE_LIMIT_BYTES + 1),
        ),
        response=SimpleNamespace(status_code=200, headers={}, raw_content=b"prefix\xffsecret"),
    )

    rs.response(flow)

    logged = json.loads(capsys.readouterr().out)
    assert logged["requestBody"] == "a" * addon.BODY_CAPTURE_LIMIT_BYTES
    assert logged["requestBodySize"] == addon.BODY_CAPTURE_LIMIT_BYTES + 1
    assert logged["requestBodyTruncated"] is True
    assert logged["responseBody"] == ""
    assert logged["responseBodyIsBinary"] is True
    assert logged["responseSize"] == len(b"prefix\xffsecret")
