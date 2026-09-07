#!/usr/bin/env bash
set -euo pipefail

# Собирает standalone-бинарник mitmdump для macOS (resources/bin/mac/).
# PyInstaller НЕ кросс-компилирует: бинарник для Windows нужно собрать на Windows-машине тем же
# scripts/mitmdump.spec — `pyinstaller scripts/mitmdump.spec --distpath resources/bin/win --workpath build`
# (в venv с requirements-build.txt), PyInstaller сам добавит .exe. Аналогично для Linux → resources/bin/linux.

cd "$(dirname "$0")/.."

if [ ! -d .venv ]; then
  echo "venv не найден, сначала запустите: scripts/setup_venv.sh --build" >&2
  exit 1
fi

source .venv/bin/activate

if ! python3 -c "import PyInstaller" 2>/dev/null; then
  echo "PyInstaller не установлен, сначала запустите: scripts/setup_venv.sh --build" >&2
  exit 1
fi

rm -rf build resources/bin/mac
pyinstaller scripts/mitmdump.spec --distpath resources/bin/mac --workpath build --noconfirm

echo "standalone-бинарник собран: resources/bin/mac/mitmdump"
