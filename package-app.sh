#!/bin/bash
# Собирает universal-бандл dist/FileSwitcher.app и архивирует его в dist/FileSwitcher.zip
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="FileSwitcher"
BUNDLE="dist/${APP_NAME}.app"
IDENTITY="${CODE_SIGN_IDENTITY:--}"

swift build -c release --arch arm64 --arch x86_64
BIN_DIR="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)"

rm -rf "$BUNDLE"
mkdir -p "${BUNDLE}/Contents/MacOS" "${BUNDLE}/Contents/Resources"
cp "${BIN_DIR}/${APP_NAME}" "${BUNDLE}/Contents/MacOS/${APP_NAME}"
cp Info.plist "${BUNDLE}/Contents/Info.plist"
cp resources/${APP_NAME}.icns "${BUNDLE}/Contents/Resources/${APP_NAME}.icns"
plutil -lint "${BUNDLE}/Contents/Info.plist"

codesign --force --options runtime --sign "$IDENTITY" "$BUNDLE"
mkdir -p dist
rm -f "dist/${APP_NAME}.zip"
ditto -c -k --keepParent "$BUNDLE" "dist/${APP_NAME}.zip"
echo "готово: ${BUNDLE} и dist/${APP_NAME}.zip"

