# Alexa morning briefing

`openclaw-alexa-morning.timer` prepares `sensor.openclaw_morning_brief` at
07:20 Europe/Berlin. A Home Assistant wake-up automation (not in this repo) reads it
later in the morning while the owner is home, then the daily news, then music.

The personal briefing aims at two to three minutes (about 320 words). It reads
the weather, today's appointments and overlaps, and the TickTick tasks in the
Personal, Work and Study lists that are overdue or due today, at most six per list
with high priority kept first. Everything not yet due is a count per list.
Tomorrow's appointments, the next deadline per list and all-day events in the
coming week are optional. Ticket keys such as `ABC-599` are not read. A failed source becomes one sentence at the
end; nothing is said when every source worked.

`lib/morning-speech.mjs` selects these items and renders them as numbered facts
with fixed dates and times. All-day TickTick dates are read in the task's time
zone: TickTick stores them as local midnight in UTC, so slicing the UTC date
announced every all-day task one day early.

Before publication, an AI language pass converts German titles into natural
English and turns meaningful emoji and symbols into spoken words. Decorative emoji
are removed. Its output must retain every ID and every numeric digit sequence and
may not contain emoji or speech markup.

`lib/morning-writer.mjs` then asks the model to write the briefing from the English
facts. Each returned paragraph lists the fact IDs it uses. The validator rejects a
paragraph that cites unknown IDs, says a number, weekday, month, today, tomorrow or
yesterday that its facts lack, or cites a task or appointment without any word of
its title. It also rejects a briefing that leaves out a required fact, puts the
problem sentence anywhere but last, or exceeds the word limit (450, or 15% above the
plain facts when those are longer). A rejected answer is retried once with the
reason. A second failure reads the required facts as written. These checks catch
invented numbers, dates and dropped items, not every paraphrase; review
`latest.txt` against `facts.json` when changing the prompt.

The language pass uses the existing OpenRouter credentials and configured Luna model.
Validated translations are cached by exact source text and context. Cache files and
previews have mode 0600. A failed language pass publishes an availability notice,
never raw unprepared wording. Home Assistant also requires `spoken_english: true`
before playing personal or news chunks and XML-escapes each message at delivery.

At 07:20 the collector also prepares an available, fresh daily-news sensor through
the same language pass. News publication preserves its original generation time.
It does not rerun the news generator or send email or WhatsApp messages.

Calendars are read from Home Assistant and every calendar accessible to the
configured Google account, including subscriptions. Exact duplicate appointments
are spoken once. Cancelled and explicitly declined Google events are omitted.
Set `requiredCalendarIds` in `workspace/config/morning-alexa.json` (copied from
`morning-alexa.example.json`) to the calendar IDs that must be readable. Until all
of them can be read, the spoken brief reports that required calendars are missing.
An empty list means no calendar is required. An empty accessible calendar
is distinguished from a failed source. Google authorization is read-only.

Credentials remain outside Git:

- Existing `gog-keyring.env` and `op-service-account.env`.
- Existing `openrouter.env` supplies `OPENROUTER_API_KEY` for spoken English editing.
- `~/.config/openclaw/morning-alexa.env` contains `TICKTICK_ACCESS_TOKEN`, mode 0600.
  The initial token was reused from the existing task-sync service. If that token
  is replaced or revoked, replace this copy too; no automatic cross-host refresh
  is configured.
- `~/.ssh/homeassistant_weather` connects to the HA add-on. The supervisor
  token stays on HA. Only sensor publication writes to HA during collection.

`node workspace/scripts/alexa-morning.mjs` collects and writes a local preview
without publishing or speaking. `--publish` additionally publishes the sensor.
Private preview and source coverage are in `workspace/state/morning-alexa`.
`source.txt` contains the untranslated facts, `facts.json` the English facts given
to the writer and `latest.txt` the spoken readout. `status.json` reports language
and writer readiness, fallback reasons, cache use and source coverage.
The job does not send WhatsApp, email, or task/calendar updates.

Weather uses the existing OpenWeatherMap collector with HA forecast fallback.
Readings are rounded to whole numbers; rain is mentioned from a 30 percent chance
and wind from 30 kilometres per hour. Official weather alerts have no configured
feed and are not mentioned.
Home Assistant rejects previous-day or more-than-two-hour-old briefing sensors
and speaks an availability message instead. Music is sequenced after all chunks.
Alexa Media Player does not provide a reliable speech-complete acknowledgment;
the automation uses conservative per-chunk delays based on both text and word
counts. Physical playback should be checked on the actual Echo.

Validation:

```sh
node --test workspace/scripts/lib/morning-speech.test.mjs workspace/scripts/lib/spoken-english.test.mjs workspace/scripts/lib/morning-writer.test.mjs
node --check workspace/scripts/alexa-morning.mjs
systemd-analyze verify deploy/openclaw-alexa-morning.service deploy/openclaw-alexa-morning.timer
```

Deployment copies the units to `/etc/systemd/system`, reloads systemd and enables
the timer. A manual start of the service publishes a briefing but does not speak.
Back up live files before replacement. Home Assistant configuration must pass
its config check before `automation.reload`; do not trigger the wake-up automation as a test, because it also operates blinds, lights and music.
