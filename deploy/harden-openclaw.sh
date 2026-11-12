#!/usr/bin/env bash
# Apply security-sensitive OpenClaw settings without copying secrets into Git.

set -euo pipefail

STATE_DIR="${OPENCLAW_STATE_DIR:-/home/openclaw/.openclaw}"
CONFIG="${OPENCLAW_CONFIG_PATH:-$STATE_DIR/openclaw.json}"
APPROVALS="$STATE_DIR/exec-approvals.json"
BACKUP_ROOT="${BACKUP_ROOT:-/home/openclaw/backups/openclaw}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$BACKUP_ROOT/$STAMP"

install -d -m 700 -o openclaw -g openclaw "$BACKUP_DIR"
install -m 600 -o openclaw -g openclaw "$CONFIG" "$BACKUP_DIR/openclaw.json"
if [[ -f "$APPROVALS" ]]; then
  install -m 600 -o openclaw -g openclaw "$APPROVALS" "$BACKUP_DIR/exec-approvals.json"
fi
cp -a /etc/systemd/system/openclaw-gateway.service "$BACKUP_DIR/" 2>/dev/null || true

config_tmp="$(mktemp "${CONFIG}.XXXXXX")"
jq '
  .gateway.trustedProxies = ["192.0.2.10/32"]
  | .gateway.auth.trustedProxy.allowLoopback = false
  | .plugins.allow = ["discord", "memory-lancedb", "whatsapp"]
  | .plugins.entries["memory-lancedb"].hooks.allowConversationAccess = true
  | .tools.media.audio = {
      "enabled": true,
      "timeoutSeconds": 60,
      "maxBytes": 20971520,
      "echoTranscript": false,
      "models": [
        {"provider": "openai", "model": "gpt-4o-mini-transcribe"},
        {"provider": "google", "model": "gemini-3-flash-preview"}
      ]
    }
  | .hooks.internal.entries["voice-capture"].enabled = true
  | (.agents.list[] | select(.id == "main") | .tools.profile) = "coding"
  | .agents.list = (
      [.agents.list[] | select(.id != "brief" and .id != "triage" and .id != "engineering" and .id != "ops")]
      + [
        {
          "id": "brief",
          "name": "Morning Brief",
          "tools": {"profile": "minimal", "deny": ["exec", "process", "write", "edit", "apply_patch", "browser"]}
        },
        {
          "id": "triage",
          "name": "Mail Triage",
          "tools": {"profile": "minimal", "deny": ["exec", "process", "write", "edit", "apply_patch", "browser"]}
        },
        {
          "id": "engineering",
          "name": "Engineering Concierge",
          "tools": {"profile": "minimal", "deny": ["exec", "process", "write", "edit", "apply_patch", "browser"]}
        },
        {
          "id": "ops",
          "name": "Operations",
          "tools": {"profile": "coding"}
        }
      ]
    )
  | (.channels.discord.enabled) = false
  | (.channels.discord.accounts.default.enabled) = false
' "$CONFIG" >"$config_tmp"
chown openclaw:openclaw "$config_tmp"
chmod 600 "$config_tmp"
mv "$config_tmp" "$CONFIG"

if [[ -f "$APPROVALS" ]]; then
  approvals_tmp="$(mktemp "${APPROVALS}.XXXXXX")"
  jq '
    .defaults.security = "allowlist"
    | .defaults.ask = "on-miss"
    | .defaults.askFallback = "deny"
    | .defaults.autoAllowSkills = false
  ' "$APPROVALS" >"$approvals_tmp"
  chown openclaw:openclaw "$approvals_tmp"
  chmod 600 "$approvals_tmp"
  mv "$approvals_tmp" "$APPROVALS"
fi

chmod 700 "$STATE_DIR"
find /home/openclaw/.config/openclaw -maxdepth 1 -type f -name '*.env' -exec chmod 600 {} +

printf 'Backup: %s\n' "$BACKUP_DIR"
