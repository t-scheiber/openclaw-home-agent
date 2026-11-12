#!/usr/bin/env bash
# Env files for Tavily + Composio skills (keys from a 1Password vault).
#
# Prerequisite vault items (Example Vault):
#   - example-tavily    — custom field "API Key" (tvly-...)
#   - example-composio  — custom field "API Key" (ak_... or ck_...)
#
# Reddit/GitHub/etc. OAuth lives in Composio dashboard (Connected Accounts).

set -euo pipefail

OP_ENV="${HOME}/.config/openclaw/op-service-account.env"
TAVILY_ENV="${HOME}/.config/openclaw/tavily.env"
COMPOSIO_ENV="${HOME}/.config/openclaw/composio.env"

if [[ ! -f "$OP_ENV" ]]; then
  echo "Missing $OP_ENV" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$OP_ENV"
set +a

mkdir -p "$(dirname "$TAVILY_ENV")"

read_op_secret() {
  local ref="$1"
  op read "$ref" 2>/dev/null | tr -d '\n'
}

# Tavily: item "example-tavily" uses custom field "API Key", or a legacy login item
TAVILY_KEY=""
for ref in \
  'op://Example Vault/example-tavily/API Key' \
  'op://Example Vault/example-tavily/password' \
  'op://Example Vault/example-tavily-legacy/password'; do
  TAVILY_KEY="$(read_op_secret "$ref")"
  [[ -n "$TAVILY_KEY" ]] && break
done
if [[ -n "$TAVILY_KEY" ]]; then
  printf 'TAVILY_API_KEY=%s\n' "$TAVILY_KEY" >"$TAVILY_ENV"
  chmod 600 "$TAVILY_ENV"
  echo "Wrote $TAVILY_ENV"
else
  echo "Skip Tavily: add the example-tavily item with an API Key field to the vault" >&2
fi

# Composio: vault item may be titled "example-composio" or "example-composio-legacy"
COMPOSIO_KEY=""
for ref in \
  'op://Example Vault/example-composio/API Key' \
  'op://Example Vault/example-composio-legacy/API Key' \
  'op://Example Vault/example-composio/password' \
  'op://Example Vault/example-composio-legacy/password'; do
  COMPOSIO_KEY="$(read_op_secret "$ref")"
  [[ -n "$COMPOSIO_KEY" ]] && break
done
if [[ -n "$COMPOSIO_KEY" ]]; then
  {
    printf 'COMPOSIO_API_KEY=%s\n' "$COMPOSIO_KEY"
    printf 'COMPOSIO_BASE=https://backend.composio.dev/api/v3\n'
  } >"$COMPOSIO_ENV"
  chmod 600 "$COMPOSIO_ENV"
  echo "Wrote $COMPOSIO_ENV"
else
  echo "Skip Composio: add the example-composio item to the vault" >&2
fi
