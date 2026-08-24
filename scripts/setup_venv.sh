#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

REQUIREMENTS_FILE="requirements.txt"
if [ "${1:-}" = "--build" ]; then
  REQUIREMENTS_FILE="requirements-build.txt"
fi

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r "$REQUIREMENTS_FILE"

echo "venv готов: source .venv/bin/activate"
