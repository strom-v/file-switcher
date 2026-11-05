#!/bin/bash
# Собирает universal-бандл FileSwitcher.app и архивирует его в dist/FileSwitcher.zip
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="FileSwitcher"
BUNDLE="build/${APP_NAME}.app"
IDENTITY="${CODE_SIGN_IDENTITY:--}"

swift build -c release --arch arm64 --arch x86_64

rm -rf "$BUNDLE"
mkdir -p "${BUNDLE}/Contents/MacOS"
cp "$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/${APP_NAME}" "${BUNDLE}/Contents/MacOS/${APP_NAME}"
cp Info.plist "${BUNDLE}/Contents/Info.plist"
plutil -lint "${BUNDLE}/Contents/Info.plist"

codesign --force --options runtime --sign "$IDENTITY" "$BUNDLE"
mkdir -p dist
rm -f "dist/${APP_NAME}.zip"
ditto -c -k --keepParent "$BUNDLE" "dist/${APP_NAME}.zip"
echo "готово: ${BUNDLE} и dist/${APP_NAME}.zip"
