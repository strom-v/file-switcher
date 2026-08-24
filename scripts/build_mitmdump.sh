#!/usr/bin/env bash
set -euo pipefail

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
