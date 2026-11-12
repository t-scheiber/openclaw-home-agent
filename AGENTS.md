# OpenClaw server operations

## Access

Git Bash cannot reach the 1Password SSH agent. Use Windows OpenSSH:

```powershell
& 'C:\Windows\System32\OpenSSH\ssh.exe' openclaw '<command>'
```

The SSH alias enters as `root`; the gateway and automation services run as
`openclaw`. Run OpenClaw CLI diagnostics as that user:

```sh
sudo -iu openclaw openclaw health
```

## Live layout

- Repository and state directory: `/home/openclaw/.openclaw`
- Tracked agent workspace: `/home/openclaw/.openclaw/workspace`
- Tracked digest source: `/home/openclaw/.openclaw/services/daily-news-digest`
- Secret config: `/home/openclaw/.openclaw/openclaw.json` and
  `/home/openclaw/.config/openclaw/*.env` (never commit)
- Gateway: `openclaw-gateway.service`; there is no Docker Compose deployment

Treat live host state as authoritative. Back up configuration before changing
the gateway, authentication, systemd units, firewall, schedulers, or secrets.

## Verification

```sh
sudo -iu openclaw openclaw health
sudo -iu openclaw openclaw security audit --deep
sudo -iu openclaw openclaw doctor
systemctl list-timers --all | grep -E 'openclaw|digest'
```

The gateway intentionally binds to LAN for the Proxmox-hosted Cloudflare
Tunnel. nftables permits port 18789 only from loopback and `192.0.2.10`,
while trusted-proxy authentication accepts only `192.0.2.10`. Do not
broaden `gateway.trustedProxies` or the firewall subnet.

Cloudflare tunnel credentials on Proxmox must remain in the root-only files
referenced by `deploy/proxmox/*/override.conf`; never put tokens back into
systemd `ExecStart` arguments.

External sends, Home Assistant writes, repository mutations, and remediation
require explicit user approval. Monitoring and triage agents are read-only.
