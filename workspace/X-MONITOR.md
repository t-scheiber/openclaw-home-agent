# X / Twitter announcement monitor

Tracks official company accounts and CEOs for product and company announcements.

## Accounts

Configured in `config/x-monitor.json` (Apple, Google, Microsoft, Samsung, Nvidia, AMD, OpenAI, Anthropic, Sony, LG, Lenovo, Cursor, plus placeholder entries for executive accounts).

## Search mode (fewer API calls)

Uses **one search request per day** instead of polling each account separately.

- Query: all tracked accounts + headline keywords (`launch`, `announce`, etc.)
- Filters out retweets/replies server-side
- Ranks by engagement (retweets, likes, quotes) and keeps the top headlines
- Minimum bar: 30+ retweets **or** 100+ likes (tweak in `config/x-monitor.json`)

**Cost:** ~1 search + ~5–15 tweet reads/day ≈ **$0.05–0.10/day** (~$2–3/month) vs ~$0.70/day with per-account polling.

Note: `min_retweets:` in the search query itself requires a higher X API tier; we filter engagement client-side instead.

## How it runs

- **Script:** `scripts/x-monitor.mjs` (polls via `xurl`, stores seen tweet IDs in `memory/x-monitor-state.json`)
- **Schedule:** once daily at **07:00 Europe/Berlin**, as part of the daily digest (no separate poll cron)
- **Delivery:** WhatsApp digest — see `DIGEST.md`

## One-time setup: xurl auth

`xurl` is installed via Homebrew (`/home/linuxbrew/.linuxbrew/bin/xurl`) but needs X API credentials:

```bash
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
xurl auth apps add openclaw \
  --client-id YOUR_CLIENT_ID \
  --client-secret YOUR_CLIENT_SECRET
# Complete OAuth flow per xurl docs (xurl auth status should show a registered app)
```

Use a [developer.x.com](https://developer.x.com) app with read access. Do **not** paste secrets into chat.

## Manual test

```bash
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"
node ~/.openclaw/workspace/scripts/x-monitor.mjs
```

## Tuning

- Edit `config/x-monitor.json` to add/remove handles or keywords
- Delete `memory/x-monitor-state.json` to re-baseline (will re-alert recent posts)

## Notifications

The daily run uses **`--queue` mode** — matches accumulate for the daily digest instead of instant alerts.

See **`DIGEST.md`** for the morning WhatsApp delivery (07:00 Europe/Berlin).
