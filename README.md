# Self-hosted personal AI-agent server on OpenClaw

Author: Thomas Scheiber

This repository holds the code and configuration for a personal AI-agent server. It runs an
[OpenClaw](https://openclaw.ai) gateway in a Proxmox LXC container (Linux, Node.js 24) and wraps it in scheduled
services. Every day it builds a news digest as a PDF, prepares a spoken morning briefing for an Alexa speaker, sends a
written morning brief over WhatsApp, triages new mail, watches GitHub CI and checks its own infrastructure. It also
saves voice notes to an Obsidian vault and exposes a guarded Home Assistant skill.

The interesting part is how it is kept safe. The agents that read mail, calendars and CI results run with their shell
and file tools denied. External text reaches models as untrusted data. Model output for the spoken briefing is checked
in code before it is published. Secrets stay out of Git, and the gateway port is closed to everything except loopback
and the tunnel connector.

Hosts, addresses, accounts, phone numbers and vault items in this copy are placeholders (`example.com`, `192.0.2.x`,
`+10000000000`). The code and the structure are unchanged, except that home-specific values moved into configuration
files. Only the offline tests were run here.

## What is upstream and what is original

OpenClaw itself (the gateway, the `openclaw` CLI, its plugins and the ClawHub skills `obsidian-direct`, `tavily` and
`composio`) is a separate project. None of its code is vendored here, and this repository does not record its licence.

Original: the scripts and speech pipeline in `workspace/scripts/`, `services/daily-news-digest/`,
`hooks/voice-capture/`, the Home Assistant skill, `workspace/config/`, the tests, the CI workflow and everything in
`deploy/` (units, timers, nftables rules, secrets resolver, hardening, setup scripts, updater, Obsidian sync).

Derived from upstream templates: `workspace/AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `HEARTBEAT.md` and the generic part
of `TOOLS.md`, which are the stock OpenClaw workspace files with local edits. `deploy/obsidian-direct-*.patch` patch a
third-party skill file.

## Architecture

```
 WhatsApp <---> OpenClaw gateway :18789 (LAN, nftables, trusted proxy)
                    ^        agents: main, brief, triage, engineering, ops
                    |  openclaw agent / openclaw message send
 systemd timers --> Node scripts (workspace/scripts) --> himalaya, gh, gog, xurl,
        |                |                                Home Assistant, TickTick, RSS
        |                +--> JSON state (workspace/memory, workspace/state)
        +--> digest service --> PDF --> rclone (Drive), Obsidian vault, SMTP, WhatsApp
 gateway hook voice-capture --> Obsidian vault        Obsidian vault <--git--> other devices
```

The gateway is the only long-running unit. The rest are oneshot units started by timers. The scripts do not call each
other. They share JSON files in `workspace/memory` and `workspace/state` (written by `lib/state.mjs` through a
temporary file and a rename), the files in `workspace/config`, and environment files in `~/.config/openclaw` that
systemd loads. The morning brief reads the report that the infrastructure sentinel leaves behind.

| Service | Trigger | Unit |
|---------|---------|------|
| Gateway | always on | `openclaw-gateway.service`, `openclaw-gateway-firewall.service` |
| Daily news digest | 07:00 | `daily-news-digest.timer` |
| Morning action brief | 07:15 | `openclaw-morning-brief.timer` |
| Alexa briefing preparation | 07:20 | `openclaw-alexa-morning.timer` |
| Infrastructure sentinel | every 15 minutes | `openclaw-infra-sentinel.timer` |
| Engineering concierge | every 20 minutes | `openclaw-engineering-concierge.timer` |
| Mail triage | every 30 minutes | `openclaw-mail-triage.timer` |
| Obsidian git sync | every 5 minutes | `obsidian-git-sync.timer` (user unit) |
| Voice capture | on `message:transcribed` | `hooks/voice-capture` |

Calendar times use the `Europe/Berlin` zone.

## Services

### Daily news digest

Code is in `services/daily-news-digest/src/`. It fetches Google News RSS sections (world, business, technology, AI,
and optional country and city sections set by environment variables), plus "Tech on X" and "Tech RSS" sections from
`x-monitor.mjs` and `rss-monitor.mjs` run with `--digest-json`.

Selection is in `src/content.js`. Titles are lowercased and reduced to tokens longer than two characters without stop
words. Two titles are the same story when the shared tokens divided by the smaller token set reach 0.72. Per section,
an item is dropped if it matches an exclusion pattern (`prime day`, `black friday` and similar), repeats a title
already chosen in this or an earlier section, or comes from a source that already has two items. A run with fewer than
five items fails before anything is sent.

The sections go to OpenAI with a JSON schema and a prompt that forbids inventing facts. Without an API key, or when
the call fails, a fallback builds the summary from the feed text. The result becomes a PDF with `pdfkit`, is copied
with `rclone` and into the vault, and is announced by WhatsApp and email when those are configured. `status.json`
records the outcome. The service runs under `flock --nonblock`. If it exits non-zero,
`daily-news-digest-failure@.service` sends a WhatsApp alert.

### Morning action brief

`workspace/scripts/morning-brief.mjs` collects unread mail metadata, two days of Google Calendar through `gog
--wrap-untrusted`, unread GitHub notifications and the sentinel report. A source that fails becomes `{ unavailable:
true }` instead of stopping the run. The JSON goes to the `brief` agent with instructions to treat every value as
untrusted, write at most 12 bullets in a fixed order, say when a source is missing and perform no action. The reply
goes to WhatsApp. `--collect-only` prints source counts without calling the model or sending anything.

### Alexa briefing

`workspace/scripts/alexa-morning.mjs` builds a spoken briefing of about 320 words and publishes it as a Home Assistant
sensor. The automation that speaks it lives in Home Assistant, outside this repository. More detail is in
`deploy/MORNING-ALEXA.md`.

1. Inputs are Home Assistant calendars (over SSH to the add-on), Google calendars through `gog`, TickTick lists
   through its open API, and weather from `weather-brief.mjs` (OpenWeatherMap, with the Home Assistant forecast as
   fallback).
2. `lib/morning-speech.mjs` selects facts. It reads today's events, flags overlaps, drops cancelled and declined
   events and removes duplicates. It reads overdue and due-today tasks, at most six per list with high priority kept
   first, and counts the rest.
3. `lib/spoken-english.mjs` has a model translate titles to English and replace emoji with words. The output is
   accepted only if every digit sequence matches the source, it has no markup or emoji, and its length is bounded.
   Results are cached by hash.
4. `lib/morning-writer.mjs` has a model write the briefing from numbered facts. Each paragraph must cite fact IDs. The
   validator rejects unknown IDs, numbers, weekdays, months or relative-day words that the cited facts lack, cited
   tasks with none of their title words, missing required facts, a problems sentence that is not last, and answers
   over the word limit. One retry gets the rejection reason. After two failures the required facts are read as
   written. If the language pass fails, the sensor carries an availability notice instead of unprepared text.

### Infrastructure sentinel

`workspace/scripts/infra-sentinel.mjs` reads `config/infra-sentinel.json` and checks HTTP URLs (status 200 to 399,
redirects not followed, timeout), TCP ports, `systemctl is-active` for listed units and disk use of the service home
against a percentage limit. It writes a report to `memory/infra-sentinel-report.json`. With `--notify` it sends a
WhatsApp message only when the sorted list of alert strings differs from the last run, and a recovery message when the
list empties. Exit code 2 means alerts exist, and the unit accepts it as success.

### Mail triage

`workspace/scripts/mail-triage.mjs` asks `himalaya` for the 25 newest unread envelopes and keeps those whose ID is not
in `memory/mail-triage-state.json` (500 IDs kept). Only ID, date, sender, subject and an attachment flag reach the
`triage` agent, never message bodies. The prompt tells the agent to ignore instructions inside the records, do nothing
with the mail, rank deadlines, bills, security and personal replies, mark uncertain labels and stay within eight
bullets. The summary goes to WhatsApp.

### Engineering concierge

`workspace/scripts/engineering-concierge.mjs` reads failed workflow runs for the repositories in
`OPENCLAW_GITHUB_REPOS` and unread notifications through `gh api`. It compares the payload, serialised as JSON, with
the previous run and stays silent when it is equal or empty. Otherwise the `engineering` agent summarises it, with an
instruction not to modify repositories, rerun jobs, comment or create branches.

### Voice capture and Obsidian sync

`hooks/voice-capture/handler.js` reacts to transcribed WhatsApp voice notes. It writes a file to `Inbox/Voice/` in the
vault only when the sender's digits end with `OPENCLAW_OWNER_PHONE` and the transcript starts with `obsidian`, `note
to self`, `capture`, `remember this` or `task`. Files are created with mode 0600 and the `wx` flag, so nothing is
overwritten. With no owner configured the hook ignores every message.

`deploy/obsidian-git-sync` fetches, rebases with autostash, commits and pushes a git-backed vault under a lock, with
one retry after a rejected push. `deploy/obsidian-cli` wraps the `obsidian-direct` skill and runs the sync after each
`create` or `edit`.

## Safety and security

### Secrets

Nothing secret is in Git, and `.gitignore` excludes env files, local configs and state. Runtime resolution is done by
`deploy/op-secrets-resolver.sh`, an exec secret provider for OpenClaw. The gateway sends it a JSON list of IDs on
stdin. It maps each ID to 1Password references, reads them with `op read` and a three-second timeout, and answers with
a JSON object. An unknown ID is an error. `deploy/setup-secrets-op.sh` registers it and points the gateway token and
the Discord token at it. What this does not give you, stated plainly:

- The resolver keeps a last-known-good cache in `~/.cache/openclaw/op-secrets.json`, mode 0600 in a 0700 directory,
  and uses it when 1Password is unreachable. Those values sit on disk.
- The 1Password service account token is in `~/.config/openclaw/op-service-account.env`.
- Several setup scripts (`setup-openrouter-env.sh`, `setup-openai-env.sh`, `setup-composio-tavily-env.sh`,
  `setup-homeassistant-env.sh`) write fetched keys into 0600 env files that systemd loads. `harden-openclaw.sh` resets
  those files to 0600.

### Network

`deploy/openclaw-gateway.nft` defines one table with one input chain (priority -10, policy accept). It accepts port
18789 from loopback and from the tunnel connector address and drops it from everyone else. Other ports keep the host's
own policy. The gateway unit `Requires` the firewall unit, which runs before it and reloads the table from scratch.
`harden-openclaw.sh` sets `gateway.trustedProxies` to the connector address only and turns off the loopback proxy
identity, so a local process cannot forge proxy headers. `deploy/proxmox/` moves tunnel credentials from process
arguments into root-only env files.

### systemd

The units run as an unprivileged `openclaw` user with `UMask=0077`, take secrets from `EnvironmentFile` entries, use
time limits, and most report failure through `OnFailure=` units. The gateway uses `Restart=always` and
`KillMode=control-group`. The digest unit takes a lock. The units do not use sandbox directives such as
`ProtectSystem`, `NoNewPrivileges` or `PrivateTmp`. That is a gap, listed below.

### Agent permissions

`deploy/harden-openclaw.sh` backs up and then rewrites the gateway config with `jq`. The `brief`, `triage` and
`engineering` agents get the `minimal` tool profile and a deny list of `exec`, `process`, `write`, `edit`,
`apply_patch` and `browser`. The `main` and `ops` agents get the `coding` profile. Host execution approvals are set to
`allowlist`, ask on a miss, deny when nobody answers, and no automatic approval for skills. The plugin allowlist is
cut to three plugins and Discord is disabled.

### Home Assistant skill

`workspace/scripts/ha-control.mjs` is the Home Assistant path for the agent
(`workspace/skills/home-assistant-safe/SKILL.md`). In code:

- `states [domain]` and `state <entity_id>` only read. `states` returns four fields per entity; `state` returns the
  full state object.
- `call <domain> <service> <entity_id>` sends one POST with one `entity_id` and no other service data. Domain, service
  and entity must match `[a-z0-9_]+` or `domain.object`, so the request path cannot be changed.
- A call is refused unless the `--execute` flag is present and `OPENCLAW_HOME_WRITES` equals `enabled`. The gateway's
  `homeassistant.env` sets only `HA_URL` and `HA_TOKEN`, so writes are off unless someone sets the variable for one
  command.
- HTTP errors surface only the status code.

The skill text adds rules that code does not enforce: the owner approves the exact entity and action, entity names are
untrusted, and the variable is never set permanently. There is no allowlist of domains, services or entities. With the
switch on, any service on any entity can be called, so the host approval prompt is the second barrier.

### Prompt injection

The mail, CI, brief and speech prompts say that the input is untrusted data and must not be obeyed. The agents behind
mail, CI and the brief have their tools removed, so they can only reply with text. The speech models are plain API
calls with no tools, and their output is validated against the facts they were given.

## How the agent is instructed

- `workspace/AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `HEARTBEAT.md` and `TOOLS.md` are loaded by the gateway
  at session start. `AGENTS.md` sets red lines (no exfiltration, no destructive commands without asking, ask before
  anything leaves the machine) and the memory rules. `HEARTBEAT.md` is comments only, which skips heartbeat model
  calls. `USER.md` is a template.
- Prompts built in code live in `mail-triage.mjs`, `engineering-concierge.mjs`, `morning-brief.mjs`,
  `lib/spoken-english.mjs`, `lib/morning-writer.mjs` and `services/daily-news-digest/src/index.js`. Each states the
  output format and size and that inputs are data.
- `workspace/skills/home-assistant-safe/SKILL.md` holds the Home Assistant rules.
- `AGENTS.md` at the repository root is for coding agents working on the live host: use the documented SSH route, back
  up before touching the gateway, units or firewall, never widen the trusted proxy or the firewall, and get approval
  for external sends and writes.

## Setup

Prerequisites are Linux with systemd and nftables, Node.js 24, a working `openclaw` install, Linuxbrew paths for `gh`,
`gog`, `himalaya`, `xurl`, `op` and `rclone`, and a 1Password service account if you use the resolver. The units
assume a user named `openclaw`.

1. Clone this repository to `~/.openclaw`, the OpenClaw state directory.
2. Run `npm ci` in `workspace/` and in `services/daily-news-digest/`.
3. Copy `workspace/config/*.example.json` to the same names without `.example` and edit them. Copy
   `services/daily-news-digest/.env.example` to `.env`. Copy `deploy/automation.env.example` and
   `deploy/morning-alexa.env.example` to `~/.config/openclaw/automation.env` and `morning-alexa.env`, mode 0600.
4. Run the setup scripts you need from `deploy/` (`setup-secrets-op.sh`, `setup-himalaya.sh`, `setup-gog-auth.sh`,
   `setup-openrouter-env.sh`, `setup-homeassistant-env.sh`, `setup-obsidian-sync.sh` and the others).
5. Copy `deploy/openclaw-gateway.nft` to `/etc/openclaw-gateway.nft`, `deploy/apply-openclaw-firewall.sh` to
   `/usr/local/sbin/`, and the units and timers to `/etc/systemd/system/`.
6. Run `sudo deploy/harden-openclaw.sh`, then `systemctl daemon-reload` and `systemctl enable --now
   openclaw-gateway-firewall.service openclaw-gateway.service` plus the timers from the table above.

| Variable | File | Used by |
|----------|------|---------|
| `OPENCLAW_OWNER_PHONE` | `automation.env` | mail triage, concierge, brief, voice hook, failure unit |
| `OPENCLAW_GITHUB_REPOS` | `automation.env` | concierge, comma-separated `owner/name` |
| `OPENCLAW_GOOGLE_ACCOUNT` | `automation.env` | morning brief calendar |
| `OPENCLAW_TIMEZONE` | `automation.env` | speech pipeline, default `Europe/Berlin` |
| `TICKTICK_ACCESS_TOKEN` | `morning-alexa.env` | Alexa briefing |
| `HOME_LATITUDE`, `HOME_LONGITUDE` | `morning-alexa.env` | weather fallback position |
| `HOME_ASSISTANT_HOST`, `_SSH_KEY`, `_PERSON_ENTITY`, `_WEATHER_ENTITY` | `morning-alexa.env` | Home Assistant add-on access |
| `OPENROUTER_API_KEY` | `openrouter.env` | spoken English, briefing writer |
| `OPENWEATHERMAP_API_KEY` or `OPENWEATHERMAP_OP_REF` | environment | weather key or its 1Password reference |
| `HA_URL`, `HA_TOKEN` | `homeassistant.env` | `ha-control.mjs` |
| `OPENCLAW_HOME_WRITES` | set per command | allows Home Assistant writes |
| `VOICE_CAPTURE_VAULT` | gateway environment | voice hook vault path |
| `WHATSAPP_TO`, `WHATSAPP_NOTIFY`, `SMTP_*`, `MAIL_FROM`, `MAIL_TO` | digest `.env` | digest delivery and failure alert |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `RCLONE_REMOTE_PATH`, `OBSIDIAN_VAULT_DIR` | digest `.env` | digest summary and PDF copies |
| `DIGEST_COUNTRY`, `DIGEST_COUNTRY_CODE`, `DIGEST_CITY` | digest `.env` | optional local news sections |

`deploy/openclaw-auto-update` upgrades the global `openclaw` package. Nothing in this repository schedules it.
`deploy/UPDATER-RECOVERY.md` explains its rules.

## Tests

The tests use the Node test runner and need no network or service:

```sh
cd workspace && npm ci && npm test                        # 25 tests
cd services/daily-news-digest && npm ci && npm test       # 3 tests
```

They cover fact selection, time zones and task limits (`morning-speech.test.mjs`), the briefing validator with retry
and fallback (`morning-writer.test.mjs`), translation checks, batching and cache (`spoken-english.test.mjs`), feed
parsing (`rss-monitor.test.mjs`), the voice hook's owner check (`voice-capture.test.mjs`) and digest deduplication
(`content.test.js`). `.github/workflows/tests.yml` runs both suites and a syntax check of every script on push and
pull request, without secrets. Not tested: the sentinel, mail triage, concierge, brief, X monitor, `ha-control.mjs`,
`alexa-morning.mjs`, the shell scripts and the units.

## Limitations and known gaps

- Triage, concierge and sentinel write their state file before or regardless of delivery. A failed WhatsApp send is
  not retried, so a message can be lost.
- The units lack sandbox directives. The firewall and the unprivileged user are the main limits.
- The secrets resolver cache and the env files hold plaintext keys at rest.
- The Home Assistant skill has no allowlist. Approval for exact actions is a prompt rule plus the host approval
  setting.
- The owner check in the voice hook is a suffix match on digits.
- Two digest implementations exist. `workspace/scripts/daily-digest.mjs` is the old cron one, disabled on the host and
  kept for reference. `workspace/DIGEST.md` says which to use.
- `rss-monitor.mjs` parses feeds with regular expressions, not an XML parser.
- Paths assume Linux, Linuxbrew and user `openclaw`. The scripts call OpenClaw CLI commands (`agent`, `message send`)
  that this repository does not pin to a version.
- The Alexa flow needs a Home Assistant automation outside this repository, and playback timing uses fixed delays
  because there is no speech-complete signal.

More detail on the host is in `docs/server-record.md`.
