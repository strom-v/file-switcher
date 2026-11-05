#!/bin/bash
# Готовит релиз: версия в Info.plist, коммит, тег, архив и черновик GitHub-релиза
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
    echo "использование: ./release.sh <версия, например 0.2.0>" >&2
    exit 2
fi

plutil -replace CFBundleShortVersionString -string "$VERSION" Info.plist
plutil -replace CFBundleVersion -string "$VERSION" Info.plist

./package-app.sh

git add Info.plist
git commit -m "Release ${VERSION}"
git tag "v${VERSION}"
git push origin HEAD --tags

NOTES="${NOTES:-Release ${VERSION}}"
gh release create "v${VERSION}" "dist/FileSwitcher.zip" --title "FileSwitcher ${VERSION}" --notes "$NOTES" --latest

# предыдущие релизы остаются доступными, но помечены как prerelease
for tag in $(gh release list --limit 50 --json tagName,isLatest --jq '.[] | select(.isLatest == false) | .tagName'); do
    gh release edit "$tag" --prerelease >/dev/null 2>&1 || true
done
echo "релиз v${VERSION} готов"
