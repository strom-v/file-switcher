"""
Контракт правила: addon.py читает поля правила по строковым ключам. Тест падает, если addon.py
обращается к ключу, которого нет в src/shared/rule.schema.json (значит TS-сторона и Python
разошлись). Не требует jsonschema — только имена свойств из схемы.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
SCHEMA = json.loads((ROOT / "src" / "shared" / "rule.schema.json").read_text())
ADDON_SRC = (ROOT / "resources" / "addon.py").read_text()


def schema_rule_keys():
    return set(SCHEMA["properties"].keys())


def addon_accessed_rule_keys():
    # rule.get("...") и rule["..."] в addon.py
    keys = set(re.findall(r'rule(?:\.get\(|\[)["\']([a-zA-Z]+)["\']', ADDON_SRC))
    return keys


def test_addon_only_reads_keys_defined_in_schema():
    unknown = addon_accessed_rule_keys() - schema_rule_keys()
    assert not unknown, f"addon.py читает поля правила, которых нет в схеме: {sorted(unknown)}"


def test_schema_covers_core_fields():
    assert {"id", "enabled", "urlPattern", "isRegex"}.issubset(schema_rule_keys())
