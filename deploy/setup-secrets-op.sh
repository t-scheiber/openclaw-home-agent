#!/usr/bin/env bash
# Wire gateway + Discord tokens to 1Password via OpenClaw SecretRefs.
#
# Prerequisite: vault items readable by the service account (read_items):
#   - example-gateway-token
#   - example-discord-token
#
# Usage: ./setup-secrets-op.sh

set -euo pipefail
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

RESOLVER_SRC="${HOME}/.openclaw/deploy/op-secrets-resolver.sh"
RESOLVER="${HOME}/.config/openclaw/op-secrets-resolver.sh"
OP_ENV="${HOME}/.config/openclaw/op-service-account.env"

if [[ ! -f "$OP_ENV" ]]; then
  echo "Missing $OP_ENV" >&2
  exit 1
fi
if [[ ! -f "$RESOLVER_SRC" ]]; then
  echo "Missing $RESOLVER_SRC (git pull ~/.openclaw)" >&2
  exit 1
fi

mkdir -p "$(dirname "$RESOLVER")"
cp "$RESOLVER_SRC" "$RESOLVER"
chmod 700 "$RESOLVER"

openclaw config set secrets.providers.op \
  --provider-source exec \
  --provider-command "$RESOLVER" \
  --provider-json-only \
  --provider-pass-env OP_SERVICE_ACCOUNT_TOKEN \
  --provider-pass-env PATH \
  --provider-pass-env HOME

openclaw config set secrets.defaults.exec op

openclaw config set gateway.auth.token \
  --ref-provider op --ref-source exec --ref-id gateway-token

openclaw config set channels.discord.accounts.default.token \
  --ref-provider op --ref-source exec --ref-id discord-bot-token

# Remove plaintext if refs replaced inline; scrub gateway-token file residue
if [[ -f "${HOME}/.openclaw/gateway-token" ]]; then
  rm -f "${HOME}/.openclaw/gateway-token"
fi

openclaw secrets audit --check --allow-exec 2>&1 || true
echo "Done. Restart gateway: sudo systemctl restart openclaw-gateway.service"
