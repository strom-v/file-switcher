"""
mitmproxy-аддон: подменяет тело/статус/заголовки ответа и заголовки запроса, задерживает ответ —
для URL, совпавших с правилом из rules.json, и логирует весь проходящий трафик в stdout как JSON.

Контракт правила (какие ключи здесь читаются) — src/shared/rule.schema.json, тот же файл использует
TS-сторона (src/shared/types.ts, rulesStore). test_rule_schema.py падает, если этот аддон обращается
к ключу, которого нет в схеме.
"""
import asyncio
import json
import mimetypes
import os
import re
import time

from mitmproxy import http, ctx

# ключи mitmproxy-flow.metadata для передачи результата матчинга правила из request() в response()
MATCH_RULE_KEY = "file_switcher_rule"
MATCH_FILE_KEY = "file_switcher_file"

# заголовки с секретами (токены, сессии, ключи) — их значения не пишутся в лог: файл сессии
# лежит на диске без шифрования и целиком уходит в HAR/JSON/CSV-экспорт, который пользователи
# пересылают в баг-репорты. Имя заголовка сохраняем, значение заменяем на плейсхолдер.
REDACTED_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "x-auth-token",
        "x-csrf-token",
        "x-xsrf-token",
    }
)
REDACTED_PLACEHOLDER = "<redacted by FileSwitcher>"

# Жёсткие пределы не дают одному запросу надолго занять event loop или разрастись в многомегабайтную
# JSONL-строку, которую Electron main затем многократно копирует при разборе и сохранении.
MAX_REGEX_PATTERN_LENGTH = 2_048
MAX_REGEX_URL_LENGTH = 8_192
BODY_CAPTURE_LIMIT_BYTES = 64 * 1024
MAX_LOG_RECORD_BYTES = 512 * 1024
MAX_LOG_TEXT_FIELD_CHARS = 16 * 1024
MAX_LOG_HEADER_CHARS = 64 * 1024
MAX_LOG_HEADER_COUNT = 100

GROUP_REFERENCE_RE = re.compile(r"\$(\d+)")
WINDOWS_ABSOLUTE_PATH_RE = re.compile(r"^[A-Za-z]:[\\/]")


def _redact_headers(headers: dict) -> dict:
    return {
        name: (REDACTED_PLACEHOLDER if name.lower() in REDACTED_HEADERS else value)
        for name, value in headers.items()
    }


class ResponseSwitcher:
    def load(self, loader):
        loader.add_option("rules_file", str, "", "Path to rules.json")

    def configure(self, updated):
        if "rules_file" in updated:
            self.rules_path = ctx.options.rules_file
            self.rules = []
            self.last_mtime = None
            # текст последней ошибки чтения rules_file — чтобы не спамить одинаковым warning
            # на каждый запрос, пока файл невалиден (перечитывание пробуется каждый раз)
            self.last_reload_error = None
            if self.rules_path:
                self._try_reload("не удалось прочитать rules_file при старте")

    def _try_reload(self, context: str) -> bool:
        try:
            self._reload()
            if self.last_reload_error is not None:
                ctx.log.info("rules_file снова читается, правила обновлены")
                self.last_reload_error = None
            return True
        except (OSError, json.JSONDecodeError, KeyError, TypeError) as e:
            msg = f"{e}"
            if msg != self.last_reload_error:
                ctx.log.warn(f"{context}: {e}. Прежние правила остаются активными, перечитывание повторяется.")
                self.last_reload_error = msg
            return False

    def _reload(self):
        with open(self.rules_path, encoding="utf-8") as f:
            self.rules = json.load(f)["rules"]
        self.last_mtime = os.path.getmtime(self.rules_path)

    @staticmethod
    def _capture_body(raw: bytes | None) -> tuple[str, bool, bool]:
        """Ограничивает и декодирует тело."""
        if not raw:
            return "", False, False

        is_truncated = len(raw) > BODY_CAPTURE_LIMIT_BYTES
        captured = raw[:BODY_CAPTURE_LIMIT_BYTES]
        try:
            return captured.decode("utf-8", errors="strict"), False, is_truncated
        except UnicodeDecodeError:
            # Бинарные байты не нужны UI и особенно сильно раздуваются при JSON-кодировании.
            return "", True, is_truncated

    @staticmethod
    def _substitute_groups(path: str, matched: "re.Match") -> str:
        def replace(m: "re.Match") -> str:
            group = m.group(1)
            return matched.group(int(group)) or ""

        return GROUP_REFERENCE_RE.sub(replace, path)

    @classmethod
    def _resolve_substituted_path(cls, path: str, matched: "re.Match") -> str:
        """Подставляет группы внутри доверенного каталога."""
        first_reference = GROUP_REFERENCE_RE.search(path)
        if first_reference is None:
            return os.path.realpath(path)

        trusted_prefix = path[: first_reference.start()]
        base_dir = os.path.dirname(trusted_prefix)
        if not base_dir:
            raise ValueError("до первой $N-подстановки не задан базовый каталог")

        for reference in GROUP_REFERENCE_RE.finditer(path):
            capture = matched.group(int(reference.group(1))) or ""
            components = re.split(r"[\\/]", capture)
            if (
                os.path.isabs(capture)
                or capture.startswith(("/", "\\"))
                or WINDOWS_ABSOLUTE_PATH_RE.match(capture)
                or ".." in components
            ):
                raise ValueError(f"небезопасное значение ${reference.group(1)}")

        resolved_base = os.path.realpath(base_dir)
        resolved_path = os.path.realpath(cls._substitute_groups(path, matched))
        try:
            is_inside_base = os.path.commonpath((resolved_base, resolved_path)) == resolved_base
        except ValueError:
            is_inside_base = False
        if not is_inside_base:
            raise ValueError("результирующий путь выходит за базовый каталог")
        return resolved_path

    @staticmethod
    def _unsafe_regex_reason(pattern: str) -> str | None:
        """Проверяет безопасный поднабор regex."""
        # Поднабор сохраняет литералы, классы, обычные/именованные группы, anchors и alternation.
        # Запрещены assertions/backrefs/conditionals, несколько повторяемых wildcard и повторяемая
        # группа с alternation либо другим repeat: именно эти конструкции дают опасный backtracking.
        if len(pattern) > MAX_REGEX_PATTERN_LENGTH:
            return f"шаблон длиннее {MAX_REGEX_PATTERN_LENGTH} символов"

        frames = [{"has_repeat": False, "has_alternation": False}]
        last_atom = None
        last_was_quantifier = False
        repeated_wildcards = 0
        index = 0

        while index < len(pattern):
            char = pattern[index]
            if char == "\\":
                if index + 1 >= len(pattern):
                    break
                escaped = pattern[index + 1]
                if escaped.isdigit() or pattern.startswith("\\g<", index):
                    return "обратные ссылки не поддерживаются"
                last_atom = ("simple", False, None)
                last_was_quantifier = False
                index += 2
                continue

            if char == "[":
                index += 1
                while index < len(pattern):
                    if pattern[index] == "\\":
                        index += 2
                        continue
                    if pattern[index] == "]":
                        index += 1
                        break
                    index += 1
                last_atom = ("simple", False, None)
                last_was_quantifier = False
                continue

            if char == "(":
                group_prefix = re.match(r"\(\?[aiLmsux-]+(?::|\))", pattern[index:])
                if pattern.startswith("(?:", index):
                    index += 3
                elif pattern.startswith("(?P<", index):
                    name_end = pattern.find(">", index + 4)
                    if name_end == -1:
                        break
                    index = name_end + 1
                elif group_prefix:
                    prefix = group_prefix.group(0)
                    index += len(prefix)
                    if prefix.endswith(")"):
                        last_atom = None
                        last_was_quantifier = False
                        continue
                elif pattern.startswith("(?", index):
                    return "assertions, conditionals и специальные группы не поддерживаются"
                else:
                    index += 1
                frames.append({"has_repeat": False, "has_alternation": False})
                last_atom = None
                last_was_quantifier = False
                continue

            if char == ")":
                if len(frames) == 1:
                    break
                group = frames.pop()
                frames[-1]["has_repeat"] |= group["has_repeat"]
                frames[-1]["has_alternation"] |= group["has_alternation"]
                last_atom = ("group", False, group)
                last_was_quantifier = False
                index += 1
                continue

            if char == "|":
                frames[-1]["has_alternation"] = True
                last_atom = None
                last_was_quantifier = False
                index += 1
                continue

            quantifier_end = None
            if char in "*+?":
                if char == "?" and last_was_quantifier:
                    last_was_quantifier = False
                    index += 1
                    continue
                quantifier_end = index + 1
            elif char == "{":
                quantifier = re.match(r"\{\d+(?:,\d*)?\}", pattern[index:])
                if quantifier:
                    quantifier_end = index + len(quantifier.group(0))

            if quantifier_end is not None and last_atom is not None:
                atom_type, is_wildcard, group = last_atom
                if atom_type == "group" and (group["has_repeat"] or group["has_alternation"]):
                    return "повторяемая группа содержит repeat или alternation"
                frames[-1]["has_repeat"] = True
                if is_wildcard:
                    repeated_wildcards += 1
                    if repeated_wildcards > 1:
                        return "несколько повторяемых wildcard не поддерживаются"
                last_was_quantifier = True
                index = quantifier_end
                continue

            last_atom = ("simple", char == ".", None) if char not in "^$" else None
            last_was_quantifier = False
            index += 1

        return None

    @staticmethod
    def _bounded_headers(headers: dict) -> tuple[dict, bool]:
        """Ограничивает заголовки для JSONL."""
        bounded = {}
        used_chars = 0
        items = list(headers.items())
        for name, value in items[:MAX_LOG_HEADER_COUNT]:
            remaining = MAX_LOG_HEADER_CHARS - used_chars
            if remaining <= 0:
                break
            name = str(name)[:remaining]
            remaining -= len(name)
            value = str(value)[:remaining]
            bounded[name] = value
            used_chars += len(name) + len(value)
        return bounded, bounded != headers

    @staticmethod
    def _serialize_log_entry(log_entry: dict) -> str:
        """Сериализует ограниченную JSONL-запись."""
        entry = dict(log_entry)
        entry["url"] = str(entry.get("url", ""))[:MAX_LOG_TEXT_FIELD_CHARS]
        entry["file"] = str(entry.get("file", ""))[:MAX_LOG_TEXT_FIELD_CHARS]
        request_headers, request_headers_truncated = ResponseSwitcher._bounded_headers(
            entry.get("requestHeaders", {})
        )
        response_headers, response_headers_truncated = ResponseSwitcher._bounded_headers(
            entry.get("responseHeaders", {})
        )
        entry["requestHeaders"] = request_headers
        entry["responseHeaders"] = response_headers
        entry["requestHeadersTruncated"] = request_headers_truncated
        entry["responseHeadersTruncated"] = response_headers_truncated

        serialized = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        if len(serialized.encode("utf-8")) < MAX_LOG_RECORD_BYTES:
            return serialized

        # Редкие управляющие символы могут расшириться до \uXXXX. В этом случае убираем оба тела,
        # но оставляем их полный размер, binary/truncated metadata и все остальные поля события.
        for prefix in ("request", "response"):
            body_key = f"{prefix}Body"
            if entry.get(body_key):
                entry[body_key] = ""
                entry[f"{prefix}BodyTruncated"] = True
        serialized = json.dumps(entry, ensure_ascii=False, separators=(",", ":"))
        if len(serialized.encode("utf-8")) < MAX_LOG_RECORD_BYTES:
            return serialized

        entry["requestHeaders"] = {}
        entry["responseHeaders"] = {}
        entry["requestHeadersTruncated"] = True
        entry["responseHeadersTruncated"] = True
        return json.dumps(entry, ensure_ascii=False, separators=(",", ":"))

    @staticmethod
    def _apply_header_overrides(headers, overrides):
        # пустое value — сигнал удалить заголовок, если он есть; иначе выставить/перезаписать
        for override in overrides or []:
            name, value = override.get("name"), override.get("value")
            if not name:
                continue
            if value:
                headers[name] = value
            elif name in headers:
                del headers[name]

    def _find_matching_rule(self, url: str):
        for rule in self.rules:
            if not rule.get("enabled"):
                continue

            # .get() вместо [] — битое правило без urlPattern (например rules.json отредактирован
            # вручную) не должно ронять обработку всех остальных запросов через KeyError
            pattern = rule.get("urlPattern")
            if not pattern:
                ctx.log.warn(f"правило {rule.get('id')} пропущено: пустой urlPattern")
                continue

            is_regex = rule.get("isRegex")
            try:
                if is_regex:
                    unsafe_reason = self._unsafe_regex_reason(pattern)
                    if unsafe_reason:
                        ctx.log.warn(f"небезопасный regex в правиле {rule.get('id')}: {unsafe_reason}")
                        continue
                    if len(url) > MAX_REGEX_URL_LENGTH:
                        ctx.log.warn(
                            f"regex правила {rule.get('id')} пропущен: URL длиннее {MAX_REGEX_URL_LENGTH} символов"
                        )
                        continue
                    matched = re.search(pattern, url)
                    if matched:
                        return rule, matched
                elif pattern == url:
                    return rule, None
            except re.error as e:
                ctx.log.warn(f"некорректный regex в правиле {rule.get('id')}: {e}")
                continue
        return None, None

    async def request(self, flow: http.HTTPFlow):
        if not self.rules_path:
            return

        try:
            mtime = os.path.getmtime(self.rules_path)
        except OSError as e:
            ctx.log.warn(f"rules_file недоступен: {e}")
            return

        if mtime != self.last_mtime:
            # при неудаче _try_reload оставляет прежние правила и повторит на следующем запросе;
            # не return — матчим по последнему валидному набору, а не пропускаем запрос вовсе
            self._try_reload("не удалось перечитать rules_file")

        rule, matched = self._find_matching_rule(flow.request.pretty_url)
        if not rule:
            return

        self._apply_header_overrides(flow.request.headers, rule.get("requestHeaderOverrides"))

        delay_ms = rule.get("delayMs")
        if delay_ms:
            await asyncio.sleep(delay_ms / 1000)

        flow.metadata[MATCH_RULE_KEY] = rule

        # инлайн-тело в самом правиле имеет приоритет над файлом на диске; в лог как "файл подмены"
        # писать нечего — тело задано прямо в правиле, поэтому пустая строка (событие всё равно matched)
        inline_body = rule.get("responseBody")
        if inline_body:
            content_type = rule.get("contentType") or "application/json; charset=utf-8"
            flow.response = self._make_swap_response(flow, inline_body.encode("utf-8"), content_type)
            flow.metadata[MATCH_FILE_KEY] = ""
            return

        path = rule.get("localFilePath")
        if not path:
            # правило только меняет заголовки/задержку/статус — тело идёт с реального сервера
            flow.metadata[MATCH_FILE_KEY] = ""
            return

        is_regex = rule.get("isRegex")
        if is_regex:
            # $1, $2, ... подставляются из групп regex-совпадения (как в Fiddler AutoResponder)
            try:
                path = self._resolve_substituted_path(path, matched)
            except (IndexError, ValueError) as e:
                ctx.log.warn(f"небезопасный localFilePath правила {rule.get('id')}: {e}")
                return
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError as e:
            ctx.log.warn(f"не удалось прочитать localFilePath {path}: {e}")
            return

        content_type = rule.get("contentType") or mimetypes.guess_type(path)[0] or "application/octet-stream"
        flow.response = self._make_swap_response(flow, body, content_type)
        flow.metadata[MATCH_FILE_KEY] = path

    @staticmethod
    def _make_swap_response(flow: http.HTTPFlow, body: bytes, content_type: str) -> http.Response:
        return http.Response.make(
            200,
            body,
            {
                "Content-Type": content_type,
                # без no-store браузер закэширует подмену и не будет видно,
                # что правило вообще сработало
                "Cache-Control": "no-store",
                # отражаем Origin запроса, иначе CORS-проверка браузера
                # может молча отклонить подменённый ответ
                "Access-Control-Allow-Origin": flow.request.headers.get("Origin", "*"),
            },
        )

    def response(self, flow: http.HTTPFlow):
        if not self.rules_path:
            return

        rule = flow.metadata.get(MATCH_RULE_KEY)
        matched_file = flow.metadata.get(MATCH_FILE_KEY)
        event = "matched" if matched_file is not None else "passed"

        if rule and flow.response:
            self._apply_header_overrides(flow.response.headers, rule.get("responseHeaderOverrides"))
            status_override = rule.get("statusCodeOverride")
            if status_override:
                flow.response.status_code = status_override

        request_body, request_body_is_binary, request_body_truncated = self._capture_body(flow.request.raw_content)

        response_body, response_body_is_binary, response_body_truncated = (
            self._capture_body(flow.response.raw_content) if flow.response else ("", False, False)
        )

        log_entry = {
            "event": event,
            "url": flow.request.pretty_url,
            "file": matched_file or "",
            "method": flow.request.method,
            "statusCode": flow.response.status_code if flow.response else None,
            "requestHeaders": _redact_headers(dict(flow.request.headers)),
            "responseHeaders": _redact_headers(dict(flow.response.headers)) if flow.response else {},
            "responseSize": len(flow.response.raw_content) if flow.response and flow.response.raw_content else 0,
            "ts": time.time(),
            "requestBody": request_body,
            "requestBodyIsBinary": request_body_is_binary,
            "requestBodySize": len(flow.request.raw_content) if flow.request.raw_content else 0,
            "requestBodyTruncated": request_body_truncated,
            "responseBody": response_body,
            "responseBodyIsBinary": response_body_is_binary,
            "responseBodyTruncated": response_body_truncated,
        }

        print(self._serialize_log_entry(log_entry), flush=True)


addons = [ResponseSwitcher()]
