#!/bin/bash
# Ставит FileSwitcher в /Applications: сборка, самопроверка, замена запущенной копии
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="FileSwitcher"
TARGET="/Applications/${APP_NAME}.app"

swift build -c release
BIN_DIR="$(swift build -c release --show-bin-path)"
"${BIN_DIR}/${APP_NAME}" --selftest

./package-app.sh

# одна копия по одному пути: старую сборку гасим перед заменой
osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
sleep 1
rm -rf "$TARGET"
cp -R "build/${APP_NAME}.app" "$TARGET"
open "$TARGET"
echo "установлено: ${TARGET}"
