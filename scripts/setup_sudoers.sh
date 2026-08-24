#!/usr/bin/env bash
# Разрешает FileSwitcher менять системный прокси (networksetup) без пароля/Touch ID при
# каждом старте/остановке — иначе macOS спрашивает подтверждение на каждый вызов.
# NOPASSWD выдаётся только на бинарник networksetup, не на произвольные команды.
set -euo pipefail

SUDOERS_FILE="/etc/sudoers.d/filesswitcher-networksetup"
RULE="$(whoami) ALL=(root) NOPASSWD: /usr/sbin/networksetup"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT
echo "$RULE" > "$TMP_FILE"
chmod 440 "$TMP_FILE"

if ! sudo visudo -c -f "$TMP_FILE" >/dev/null; then
  echo "правило не прошло проверку синтаксиса, ничего не установлено" >&2
  exit 1
fi

sudo cp "$TMP_FILE" "$SUDOERS_FILE"
sudo chmod 440 "$SUDOERS_FILE"
sudo chown root:wheel "$SUDOERS_FILE"

echo "готово: $SUDOERS_FILE"
echo "чтобы отменить: sudo rm $SUDOERS_FILE"
