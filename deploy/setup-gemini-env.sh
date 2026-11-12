#!/usr/bin/env bash
# Gemini API key for OpenClaw google provider + memory-lancedb embeddings.
#
# Usage:
#   GEMINI_API_KEY='AIza...' ./setup-gemini-env.sh
# Or store in 1Password and pass via env when running.

set -euo pipefail

GEMINI_ENV="${HOME}/.config/openclaw/gemini.env"
KEY="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-}}"

if [[ -z "$KEY" ]]; then
  echo "Set GEMINI_API_KEY (or GOOGLE_API_KEY) before running." >&2
  exit 1
fi

mkdir -p "$(dirname "$GEMINI_ENV")"
{
  printf 'GEMINI_API_KEY=%s\n' "$KEY"
  printf 'GOOGLE_API_KEY=%s\n' "$KEY"
} >"$GEMINI_ENV"
chmod 600 "$GEMINI_ENV"
echo "Wrote $GEMINI_ENV"
echo "Restart gateway: sudo systemctl restart openclaw-gateway.service"
