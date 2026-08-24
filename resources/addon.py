"""
mitmproxy-аддон: подменяет тело ответа для URL, совпавших с правилом из rules.json,
и логирует весь проходящий трафик (совпадения и обычные запросы) в stdout как JSON.
"""
import json
import mimetypes
import os
import re
import time

from mitmproxy import http, ctx

# ключ mitmproxy-flow.metadata, где храним результат матчинга правила для передачи из request() в response()
MATCH_META_KEY = "file_switcher_match"


class ResponseSwitcher:
    def load(self, loader):
        loader.add_option("rules_file", str, "", "Path to rules.json")

    def configure(self, updated):
        if "rules_file" not in updated:
            return
        self.rules_path = ctx.options.rules_file
        self.rules = []
        self.last_mtime = None
        if self.rules_path:
            self._reload()

    def _reload(self):
        with open(self.rules_path, encoding="utf-8") as f:
            self.rules = json.load(f)["rules"]
        self.last_mtime = os.path.getmtime(self.rules_path)

    @staticmethod
    def _substitute_groups(path: str, matched: "re.Match") -> str:
        def replace(m: "re.Match") -> str:
            group = m.group(1)
            return matched.group(int(group)) or ""

        return re.sub(r"\$(\d+)", replace, path)

    def request(self, flow: http.HTTPFlow):
        if not self.rules_path:
            return

        try:
            mtime = os.path.getmtime(self.rules_path)
        except OSError as e:
            ctx.log.warn(f"rules_file недоступен: {e}")
            return

        if mtime != self.last_mtime:
            try:
                self._reload()
            except (OSError, json.JSONDecodeError, KeyError) as e:
                ctx.log.warn(f"не удалось перечитать rules_file: {e}")
                return

        url = flow.request.pretty_url
        for rule in self.rules:
            if not rule.get("enabled"):
                continue

            pattern = rule["urlPattern"]
            is_regex = rule.get("isRegex")
            try:
                matched = re.search(pattern, url) if is_regex else (pattern == url)
            except re.error as e:
                ctx.log.warn(f"некорректный regex в правиле {rule.get('id')}: {e}")
                continue

            if not matched:
                continue

            path = rule["localFilePath"]
            if is_regex:
                # $1, $2, ... подставляются из групп regex-совпадения (как в Fiddler AutoResponder)
                try:
                    path = self._substitute_groups(path, matched)
                except IndexError as e:
                    ctx.log.warn(f"некорректная группа $N в localFilePath правила {rule.get('id')}: {e}")
                    continue
            try:
                with open(path, "rb") as f:
                    body = f.read()
            except OSError as e:
                ctx.log.warn(f"не удалось прочитать localFilePath {path}: {e}")
                continue

            content_type = rule.get("contentType") or mimetypes.guess_type(path)[0] or "application/octet-stream"
            flow.response = http.Response.make(
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
            flow.metadata[MATCH_META_KEY] = path
            return

    def response(self, flow: http.HTTPFlow):
        if not self.rules_path:
            return

        matched_file = flow.metadata.get(MATCH_META_KEY, "")
        event = "matched" if matched_file else "passed"

        print(
            json.dumps(
                {
                    "event": event,
                    "url": flow.request.pretty_url,
                    "file": matched_file,
                    "method": flow.request.method,
                    "statusCode": flow.response.status_code if flow.response else None,
                    "requestHeaders": dict(flow.request.headers),
                    "responseHeaders": dict(flow.response.headers) if flow.response else {},
                    "responseSize": len(flow.response.raw_content) if flow.response and flow.response.raw_content else 0,
                    "ts": time.time(),
                }
            ),
            flush=True,
        )


addons = [ResponseSwitcher()]
