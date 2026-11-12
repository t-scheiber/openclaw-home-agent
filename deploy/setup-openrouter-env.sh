#!/usr/bin/env bash
# OpenRouter API key for primary model routing.
#
# Prerequisite vault item (Example Vault):
#   - example-openrouter — password field = sk-or-... from https://openrouter.ai/keys
#
# Or: OPENROUTER_API_KEY=sk-or-... ./setup-openrouter-env.sh

set -euo pipefail

OP_ENV="${HOME}/.config/openclaw/op-service-account.env"
OPENROUTER_ENV="${HOME}/.config/openclaw/openrouter.env"
KEY="${OPENROUTER_API_KEY:-}"

if [[ -z "$KEY" && -f "$OP_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$OP_ENV"
  set +a
  for ref in \
    'op://Example Vault/example-openrouter/password' \
    'op://Example Vault/example-openrouter-alt/password' \
    'op://Example Vault/example-openrouter-alt/API Key'; do
    KEY="$(op read "$ref" 2>/dev/null | tr -d '\n')" && break
  done
fi

if [[ -z "$KEY" ]]; then
  echo "Missing OpenRouter key. Add vault item 'example-openrouter' or set OPENROUTER_API_KEY." >&2
  exit 1
fi

mkdir -p "$(dirname "$OPENROUTER_ENV")"
printf 'OPENROUTER_API_KEY=%s\n' "$KEY" >"$OPENROUTER_ENV"
chmod 600 "$OPENROUTER_ENV"
echo "Wrote $OPENROUTER_ENV"

eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
echo "$KEY" | openclaw models auth paste-api-key --provider openrouter --profile-id openrouter:api-key
echo "Restart gateway: sudo systemctl restart openclaw-gateway.service"
