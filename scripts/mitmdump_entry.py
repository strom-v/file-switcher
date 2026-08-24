"""
Entry-point для PyInstaller: оборачивает штатный mitmdump CLI.
"""
from mitmproxy.tools.main import mitmdump

if __name__ == "__main__":
    mitmdump()
