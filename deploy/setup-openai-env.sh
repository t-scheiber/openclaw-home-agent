#!/usr/bin/env bash
# Materialize the OpenAI API key from a restricted 1Password vault.

set -euo pipefail

OP_ENV="${HOME}/.config/openclaw/op-service-account.env"
OPENAI_ENV="${HOME}/.config/openclaw/openai.env"
set -a
source "$OP_ENV"
set +a

KEY="$(op item get "example-openai-key" --vault "Example Vault" --fields password)"
[[ -n "$KEY" ]] || { echo "OpenAI key is empty" >&2; exit 1; }
install -d -m 700 "$(dirname "$OPENAI_ENV")"
umask 077
printf 'OPENAI_API_KEY=%s\n' "$KEY" >"$OPENAI_ENV"
chmod 600 "$OPENAI_ENV"
echo "Wrote $OPENAI_ENV"

