---
name: voice-capture
description: "Capture explicitly addressed WhatsApp voice notes into the Obsidian inbox"
metadata:
  {
    "openclaw":
      {
        "emoji": "🎙️",
        "events": ["message:transcribed"],
      },
  }
---

# Voice Capture Hook

Voice notes from the configured owner are saved to Obsidian when their
transcript starts with `Obsidian`, `note to self`, `capture`, `remember this`,
or `task`. Other voice notes are left untouched.

Configuration comes from the environment of the gateway process:

- `OPENCLAW_OWNER_PHONE` is the owner's number. Without it the hook ignores
  every message.
- `VOICE_CAPTURE_VAULT` is the vault directory. The default is
  `~/Obsidian/Vault`. Notes land in `Inbox/Voice/` as one file per capture.
