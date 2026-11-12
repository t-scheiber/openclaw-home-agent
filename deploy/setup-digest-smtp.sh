#!/usr/bin/env bash
# Wire daily-news-digest SMTP from a 1Password vault.
# Prerequisite: an "example-agent-mail" login item in Example Vault.

set -euo pipefail

ENV_FILE="${HOME}/.openclaw/services/daily-news-digest/.env"
OP_ENV="${HOME}/.config/openclaw/op-service-account.env"
MAIL_TO="${1:-user@example.com}"

if [[ ! -f "$OP_ENV" ]]; then
  echo "Missing $OP_ENV" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$OP_ENV"
set +a

SMTP_USER=$(op read "op://Example Vault/example-agent-mail/username")
SMTP_PASS=$(op read "op://Example Vault/example-agent-mail/password")

update_var() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >>"$ENV_FILE"
  fi
}

update_var SMTP_HOST smtp.example.com
update_var SMTP_PORT 587
update_var SMTP_SECURE false
update_var SMTP_USER "$SMTP_USER"
update_var SMTP_PASS "$SMTP_PASS"
update_var MAIL_FROM "agent@example.com"
update_var MAIL_TO "$MAIL_TO"

echo "Updated $ENV_FILE (MAIL_TO=$MAIL_TO)"
