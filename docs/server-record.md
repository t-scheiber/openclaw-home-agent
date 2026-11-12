# Server record

Setup notes for the host that runs the OpenClaw gateway. This is the operator's
record, kept next to the code. Host names, addresses and accounts are placeholders.
The README describes the system; this file lists what is installed and how it was wired.

## Host

| | |
|---|---|
| Type | Proxmox VE LXC container, x86_64 |
| Host name | `openclaw` |
| Service user | `openclaw` |
| Disk and RAM | 98 GB, 20 GB |
| Node.js | v24 |
| SSH tunnel | `ssh-agent.example.com` (Cloudflare Access) |
| Gateway UI | `https://agent.example.com` (Cloudflare Tunnel) |

### SSH client configuration

```sshconfig
Host openclaw
	HostName ssh-agent.example.com
	User openclaw
	ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname ssh-agent.example.com
	IdentitiesOnly yes
	IdentityFile ~/.ssh/openclaw.pub

Host openclaw-ui
	HostName ssh-agent.example.com
	User openclaw
	ProxyCommand /opt/homebrew/bin/cloudflared access ssh --hostname ssh-agent.example.com
	IdentitiesOnly yes
	IdentityFile ~/.ssh/openclaw.pub
	LocalForward 18789 127.0.0.1:18789
	ExitOnForwardFailure yes
```

`ssh openclaw` opens a shell. `ssh openclaw-ui` also forwards the gateway UI to
`http://127.0.0.1:18789`.

The gateway binds to the LAN because the Cloudflare Tunnel connector runs on the
Proxmox host (192.0.2.10 in these files). The nftables table in
`deploy/openclaw-gateway.nft` lets only loopback and that address reach port 18789.
Trusted-proxy authentication trusts only that address, and loopback processes cannot
forge proxy identity headers.

## OpenClaw

| | |
|---|---|
| Version | 2026.6.8 at the time of writing |
| Install | global npm package under `/usr/lib/node_modules/openclaw`, CLI at `/usr/bin/openclaw` |
| Config | `~/.openclaw/openclaw.json`, secret, not in this repository |
| State directory | `~/.openclaw` (`OPENCLAW_STATE_DIR`) |
| Default model | `openrouter/deepseek/deepseek-v4-flash`, fallback `google/gemini-3-flash-preview` |
| Command owner | `whatsapp:+10000000000` |

Channels: WhatsApp is linked with a pairing DM policy. Discord is disabled until explicit
guild and channel IDs are added. Enabled plugins include browser, canvas, discord,
google, memory-lancedb, openrouter and whatsapp. `deploy/harden-openclaw.sh` narrows the
plugin allowlist to discord, memory-lancedb and whatsapp.

## Layout of `~/.openclaw`

| Path | What | In this repository |
|------|------|--------------------|
| `openclaw.json` and backups | gateway config with tokens | no, secret |
| `gateway-token`, `identity/`, `devices/`, `credentials/` | auth, pairings, channel credentials | no, secret |
| `state/`, `agents/` | gateway database, per-agent sessions | no, runtime |
| `npm/`, `tools/`, `logs/`, `extensions/`, `plugin-skills/` | caches, runtimes, logs, plugins | no, runtime |
| `workspace/` | agent workspace source | yes, runtime paths ignored |
| `services/daily-news-digest/` | digest pipeline | yes, `.env` ignored |
| `deploy/` | systemd units, firewall, install scripts | yes |
| `hooks/` | gateway hooks | yes |

## CLI tools

Installed under `/home/linuxbrew/.linuxbrew/bin/`, on PATH through `brew shellenv` in the
shell profile and in the gateway unit.

| Tool | Use |
|------|-----|
| `gh` | GitHub CLI, used by the engineering concierge and the morning brief |
| `gog` | Google Workspace CLI for calendar, Drive and Gmail |
| `clawhub` | skill registry client |
| `rg`, `tmux` | session log search, long-running sessions |
| `blogwatcher` | RSS and blog monitoring |
| `xurl` | X API CLI |
| `op` | 1Password CLI, authenticated by a service account |
| `rclone` | Google Drive remote `gdrive:` for the digest PDF |
| `himalaya` | IMAP and SMTP client for the mail triage |

## 1Password service account

The gateway uses a service account that can read one vault (`read_items`). Service accounts
cannot read the built-in Private vault, so server secrets live in a dedicated vault.

| | |
|---|---|
| Token file | `~/.config/openclaw/op-service-account.env`, not in the repository |
| Gateway wiring | `EnvironmentFile` entries in `deploy/openclaw-gateway.service` |
| Resolver | `deploy/op-secrets-resolver.sh`, installed by `deploy/setup-secrets-op.sh` |

```sh
op service-account create "example-service-account" --vault "Example Vault:read_items"
```

Example vault items (fake names): `example-agent-mail`, `example-user-mailbox`,
`example-gateway-token`, `example-openrouter`, `example-tavily`, `example-composio`,
`example-home-assistant`. The digest reads SMTP credentials from
`services/daily-news-digest/.env`, filled by `deploy/setup-digest-smtp.sh`.

## Mail through himalaya

`deploy/setup-himalaya.sh` writes `~/.config/himalaya/config.toml` with two accounts,
`openclaw` (default) and `mail`. Passwords come from small `op read` wrapper scripts, so
`config.toml` holds no secret.

```sh
himalaya envelope list -a mail --page-size 5
himalaya message read -a mail <id>
```

## Google through gog

`deploy/setup-gog-auth.sh` registers an OAuth desktop client and stores a refresh token for
the account in `GOG_ACCOUNT`. The keyring password lives in
`~/.config/openclaw/gog-keyring.env`. The client secret is stored with `--insecure`,
which means in a file under `~/.local/share/gogcli/`. Enable the Drive, Gmail and Calendar
APIs in the Google Cloud project (`example-gcp-project`).

## Skills and plugins

| Skill | Source | Notes |
|-------|--------|-------|
| `obsidian-direct` | ClawHub | vault search, read and write without a desktop app, patched by `deploy/*.patch` |
| `openai-whisper-api` | bundled | disabled, needs an OpenAI key |
| `tavily` | ClawHub | web search, needs `TAVILY_API_KEY` |
| `composio` | ClawHub | third-party app actions, needs `COMPOSIO_API_KEY` |
| `home-assistant-safe` | this repository | guarded Home Assistant access, see the README |

The `memory-lancedb` plugin owns the memory slot and uses Gemini embeddings.
OpenRouter is the primary model route (`deploy/setup-openrouter-env.sh`); Gemini is the
fallback (`deploy/setup-gemini-env.sh`).

## Maintenance

```sh
openclaw doctor --fix          # normalise config, disable unusable skills
openclaw health                # channel and gateway status
openclaw skills list           # ready versus needs-setup
openclaw security audit --deep # security review
sudo systemctl restart openclaw-gateway.service
```

Open follow-ups from the operator's list: rotate the Cloudflare tunnel and Access service
tokens that were once passed as process arguments, migrate remaining plaintext secrets with
`openclaw secrets configure`, add Discord guild IDs before re-enabling Discord, and finish
X OAuth if live posting is wanted.
