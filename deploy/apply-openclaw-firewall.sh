#!/usr/bin/env bash
# Restrict the OpenClaw Gateway to the local host and the Proxmox-hosted
# Cloudflare Tunnel connector. Other host services keep their existing policy.

set -euo pipefail

NFT_BIN="${NFT_BIN:-/usr/sbin/nft}"
RULES="${1:-/etc/openclaw-gateway.nft}"

"$NFT_BIN" delete table inet openclaw_gateway 2>/dev/null || true
"$NFT_BIN" -f "$RULES"

