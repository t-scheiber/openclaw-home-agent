#!/usr/bin/env bash
# Google (gog) OAuth setup for the account in GOG_ACCOUNT on OpenClaw.
#
# Prerequisite: OAuth Desktop client JSON from Google Cloud Console.
#   https://console.cloud.google.com/apis/credentials
#   → Create Credentials → OAuth client ID → Desktop app → Download JSON
#
# Usage (remote OAuth on server):
#   ./setup-gog-auth.sh /path/to/client_secret_....json
#   ./setup-gog-auth.sh /path/to/client_secret_....json 'http://localhost:...'
#
# Alternative (sign in on Mac, copy token to server):
#   gog auth login --listen-addr 127.0.0.1:8090          # on Mac
#   gog auth tokens export user@example.com --out /tmp/gog-token.json
#   scp /tmp/gog-token.json openclaw:/tmp/
#   source ~/.config/openclaw/gog-keyring.env            # on server
#   gog auth credentials set --insecure /path/to/client.json
#   gog auth tokens import /tmp/gog-token.json
#
# Remote flow (no SSH port forward):
#   Step 1 prints a URL — open on your Mac, sign in, copy the redirect URL.
#   Step 2 exchanges the redirect URL for a stored refresh token.

set -euo pipefail
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

CREDS="${1:-}"
AUTH_URL="${2:-}"
EMAIL="${GOG_ACCOUNT:-user@example.com}"
SERVICES="drive,gmail,calendar"
KEYRING_ENV="${HOME}/.config/openclaw/gog-keyring.env"

if [[ -z "$CREDS" || ! -f "$CREDS" ]]; then
  echo "Usage: $0 /path/to/credentials.json [redirect-url-from-browser]" >&2
  exit 1
fi

if [[ ! -f "$KEYRING_ENV" ]]; then
  KEYRING_PASS="$(openssl rand -base64 24)"
  mkdir -p "$(dirname "$KEYRING_ENV")"
  printf 'GOG_KEYRING_PASSWORD=%s\n' "$KEYRING_PASS" >"$KEYRING_ENV"
  chmod 600 "$KEYRING_ENV"
  echo "Created $KEYRING_ENV (gateway reads this via systemd EnvironmentFile)"
fi
set -a
# shellcheck source=/dev/null
source "$KEYRING_ENV"
set +a

gog auth credentials set --insecure "$CREDS"

if [[ -z "$AUTH_URL" ]]; then
  echo
  echo "=== Step 1: open this URL on your Mac ==="
  gog auth add "$EMAIL" --remote --step 1 --services "$SERVICES"
  echo
  echo "After authorizing, re-run:"
  echo "  $0 '$CREDS' 'PASTE_FULL_REDIRECT_URL_HERE'"
  exit 0
fi

gog auth add "$EMAIL" --remote --step 2 --auth-url "$AUTH_URL" --services "$SERVICES"
echo
gog auth list
gog drive ls --max 3 2>/dev/null || true
