# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.0.2.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)

## Notes / Obsidian

- **Vault:** `/home/openclaw/Obsidian/Vault` (plain Markdown).
- Use the allowlisted `obsidian-cli` wrapper for search, list, read, create, and edit operations. Do not invoke the Python skill script directly.
- A user request to create or edit an Obsidian note authorizes that note change and the wrapper's automatic Git commit and push; do not request a second shell approval.
- Successful `create` and `edit` commands synchronously fetch/rebase, commit, and push to the Obsidian Git repository before returning.
- If a direct file-writing tool is unavoidable, immediately run `/home/openclaw/.local/bin/obsidian-git-sync` and report success only after it finishes.
- The server also fetches/rebases every five minutes so changes from other devices stay current. Git is the source of truth for device synchronization.
- Conventions: `[[wikilinks]]`, one note per topic, attachments under `attachments/`.

### X / Twitter monitor

- **xurl:** `/home/linuxbrew/.linuxbrew/bin/xurl` (Homebrew; run `eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"` in non-interactive shells)
- **Config:** `config/x-monitor.json`
- **Script:** `scripts/x-monitor.mjs`
- **Docs:** `X-MONITOR.md`
- **Auth status:** `xurl auth status` (needs one-time X API app registration)

### Daily digest (WhatsApp)

- **Schedule:** systemd timer `daily-news-digest.timer` at 07:00 Europe/Berlin
- **Pipeline:** `~/.openclaw/services/daily-news-digest/` (not OpenClaw cron)
- **Scripts:** `scripts/x-monitor.mjs`, `scripts/rss-monitor.mjs` (tech sections)
- **Docs:** `DIGEST.md`
- **WhatsApp:** the number in `WHATSAPP_TO` in the digest service `.env`

### RSS monitor

- **Config:** `config/rss-feeds.json` (The Verge, Ars Technica, Hacker News)
- **Script:** `scripts/rss-monitor.mjs` (uses curl with bounded retries and the host resolver)
- **Obsidian archive:** `Vault/Daily/YYYY-MM-DD Tech digest.md`
- **Cron failure alerts:** WhatsApp on digest job errors
