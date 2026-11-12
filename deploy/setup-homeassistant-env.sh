#!/usr/bin/env bash
set -euo pipefail

TARGET="${HOME}/.config/openclaw/homeassistant.env"
TOKEN="${HA_TOKEN:-}"
if [[ -z "$TOKEN" && -f "${HOME}/.config/openclaw/op-service-account.env" ]]; then
  set -a
  source "${HOME}/.config/openclaw/op-service-account.env"
  set +a
  for ref in \
    'op://Example Vault/example-home-assistant/token' \
    'op://Example Vault/example-home-assistant/password'; do
    TOKEN="$(op read "$ref" 2>/dev/null || true)"
    [[ -n "$TOKEN" ]] && break
  done
fi

[[ -n "$TOKEN" ]] || {
  echo "Add a Home Assistant long-lived access token to the vault item 'example-home-assistant'." >&2
  exit 1
}
install -d -m 700 "$(dirname "$TARGET")"
umask 077
{
  printf 'HA_URL=%s\n' "${HA_URL:-https://home.example.com}"
  printf 'HA_TOKEN=%s\n' "$TOKEN"
} >"$TARGET"
chmod 600 "$TARGET"

