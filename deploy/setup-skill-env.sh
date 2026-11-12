#!/usr/bin/env bash
# Env files for ClawHub/managed skills (obsidian-direct).
set -euo pipefail

OBSIDIAN_ENV="${HOME}/.config/openclaw/obsidian.env"
VAULT="${OBSIDIAN_VAULT:-/home/openclaw/Obsidian/Vault}"

mkdir -p "$(dirname "$OBSIDIAN_ENV")"
printf 'OBSIDIAN_VAULT=%s\n' "$VAULT" >"$OBSIDIAN_ENV"
chmod 600 "$OBSIDIAN_ENV"

echo "Wrote $OBSIDIAN_ENV"
echo "For Gemini model auth, run deploy/setup-gemini-env.sh"
