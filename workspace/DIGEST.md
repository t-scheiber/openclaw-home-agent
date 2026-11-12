# Daily news digest (unified)

One morning digest at **07:00 Europe/Berlin** (set by the systemd timer): Google News
sections (world, business, tech, AI, plus optional country and city sections) and
the OpenClaw tech sections (X search and RSS), summarised by OpenAI and delivered
as a Speechify-friendly PDF.

## Flow

1. **systemd timer** `daily-news-digest.timer` runs `services/daily-news-digest/src/index.js`
   through `npm run run`.
2. It fetches **Tech on X** and **Tech RSS** from the workspace scripts (`--digest-json`).
3. It fetches the Google News RSS sections.
4. Sections are filtered and deduplicated (`src/content.js`), summarised by OpenAI
   (extractive fallback without a key) and written to a PDF.
5. The PDF goes to Google Drive through `rclone` and into the Obsidian vault.
6. A short WhatsApp message announces the PDF, and an email is sent when SMTP is configured.

The older workspace pipeline (`scripts/daily-digest.mjs`, driven by an OpenClaw cron job)
is disabled. Do not run both.

## Files

| Location | Purpose |
|----------|---------|
| `services/daily-news-digest/` | Main pipeline (systemd) |
| `workspace/scripts/x-monitor.mjs` | X search for tech announcements |
| `workspace/scripts/rss-monitor.mjs` | The Verge, Ars Technica, Hacker News |
| `workspace/config/x-monitor.json` | X accounts, search mode |
| `workspace/config/rss-feeds.json` | RSS feed list |
| `services/daily-news-digest/.env` | OpenAI, SMTP, WhatsApp, Obsidian and rclone settings (git-ignored) |

## Manual test

```bash
cd services/daily-news-digest && npm run run
```

## Change the WhatsApp number

Edit `WHATSAPP_TO` in `services/daily-news-digest/.env`.

## Requires

- `xurl` authenticated (see `X-MONITOR.md`) for live X data
- `rclone` with a `gdrive:` remote for the PDF upload
