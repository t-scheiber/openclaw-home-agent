#!/usr/bin/env bash
# Configure Himalaya IMAP/SMTP for example IMAP/SMTP mailboxes from a 1Password vault.
# Vault items: "example-agent-mail", "example-user-mailbox"

set -euo pipefail
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

OP_DIR="${HOME}/.config/openclaw"
OP_READ_OPENCLAW="${OP_DIR}/op-read-himalaya-openclaw.sh"
OP_READ_MAIL="${OP_DIR}/op-read-himalaya-mail.sh"
CONFIG_DIR="${HOME}/.config/himalaya"
CONFIG_FILE="${CONFIG_DIR}/config.toml"

mkdir -p "$OP_DIR" "$CONFIG_DIR"

cat >"$OP_READ_OPENCLAW" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck source=/dev/null
source "${HOME}/.config/openclaw/op-service-account.env"
set +a
op read 'op://Example Vault/example-agent-mail/password'
EOF
chmod 700 "$OP_READ_OPENCLAW"

cat >"$OP_READ_MAIL" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
set -a
# shellcheck source=/dev/null
source "${HOME}/.config/openclaw/op-service-account.env"
set +a
op read 'op://Example Vault/example-user-mailbox/password'
EOF
chmod 700 "$OP_READ_MAIL"

cat >"$CONFIG_FILE" <<EOF
# Example mail provider, passwords via 1Password service account (op-read.sh)
# Regenerate: ~/.openclaw/deploy/setup-himalaya.sh

[accounts.openclaw]
email = "agent@example.com"
display-name = "OpenClaw"
default = true

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "agent@example.com"
backend.auth.type = "password"
backend.auth.cmd = "${OP_READ_OPENCLAW}"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "agent@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "${OP_READ_OPENCLAW}"

[accounts.mail]
email = "user@example.com"
display-name = "Mail"

backend.type = "imap"
backend.host = "imap.example.com"
backend.port = 993
backend.encryption.type = "tls"
backend.login = "user@example.com"
backend.auth.type = "password"
backend.auth.cmd = "${OP_READ_MAIL}"

message.send.backend.type = "smtp"
message.send.backend.host = "smtp.example.com"
message.send.backend.port = 587
message.send.backend.encryption.type = "start-tls"
message.send.backend.login = "user@example.com"
message.send.backend.auth.type = "password"
message.send.backend.auth.cmd = "${OP_READ_MAIL}"
EOF
chmod 600 "$CONFIG_FILE"

echo "Wrote $CONFIG_FILE"

if ! command -v himalaya >/dev/null; then
  echo "Install himalaya first: brew install himalaya" >&2
  exit 1
fi

himalaya account list
himalaya folder list -a openclaw | head -5
himalaya folder list -a mail | head -5
echo "Himalaya accounts OK"
