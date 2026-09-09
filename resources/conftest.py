"""Стаб mitmproxy.ctx.log — вне запущенного mitmproxy его нет, а addon.py пишет туда предупреждения."""
import pytest
from mitmproxy import ctx


class _StubLog:
    def warn(self, *_a, **_k):
        pass

    def info(self, *_a, **_k):
        pass

    def error(self, *_a, **_k):
        pass


@pytest.fixture(autouse=True)
def _stub_ctx_log():
    ctx.log = _StubLog()
    yield
