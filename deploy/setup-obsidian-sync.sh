#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${HOME}/.local/bin"
UNIT_DIR="${HOME}/.config/systemd/user"

mkdir -p "$BIN_DIR" "$UNIT_DIR"
install -m 0755 "$ROOT_DIR/deploy/obsidian-git-sync" "$BIN_DIR/obsidian-git-sync"
install -m 0755 "$ROOT_DIR/deploy/obsidian-cli" "$BIN_DIR/obsidian-cli"
install -m 0644 "$ROOT_DIR/deploy/obsidian-git-sync.service" "$UNIT_DIR/obsidian-git-sync.service"
install -m 0644 "$ROOT_DIR/deploy/obsidian-git-sync.timer" "$UNIT_DIR/obsidian-git-sync.timer"

skill_file="${HOME}/.openclaw/skills/obsidian-direct/SKILL.md"
if [[ -f "$skill_file" ]] && ! grep -q '^## Git Synchronization$' "$skill_file"; then
  patch --forward "$skill_file" <"$ROOT_DIR/deploy/obsidian-direct-sync.patch"
fi
if [[ -f "$skill_file" ]] && grep -q '^python3 obsidian_search.py ' "$skill_file"; then
  patch --forward "$skill_file" <"$ROOT_DIR/deploy/obsidian-direct-search-wrapper.patch"
fi

openclaw approvals allowlist add --agent '*' "$BIN_DIR/obsidian-cli"
openclaw approvals allowlist add --agent '*' "$BIN_DIR/obsidian-git-sync"

systemctl --user daemon-reload
systemctl --user enable --now obsidian-git-sync.timer
systemctl --user start obsidian-git-sync.service

echo "Installed immediate Obsidian edit sync and periodic five-minute pull."
