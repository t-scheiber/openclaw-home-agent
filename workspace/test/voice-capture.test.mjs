import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import voiceCapture from '../../hooks/voice-capture/handler.js';

test('voice capture writes explicitly addressed owner notes', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-capture-'));
  process.env.VOICE_CAPTURE_VAULT = vault;
  process.env.OPENCLAW_OWNER_PHONE = '+10000000000';
  await voiceCapture({
    type: 'message',
    action: 'transcribed',
    timestamp: '2026-06-28T20:00:00.000Z',
    context: {
      from: 'whatsapp:+10000000000',
      channelId: 'whatsapp',
      transcript: 'Note to self: prepare the release checklist',
    },
  });
  const files = await fs.readdir(path.join(vault, 'Inbox', 'Voice'));
  assert.equal(files.length, 1);
  assert.match(await fs.readFile(path.join(vault, 'Inbox', 'Voice', files[0]), 'utf8'),
    /prepare the release checklist/);
});

test('voice capture ignores other senders and does nothing without a configured owner', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-capture-'));
  process.env.VOICE_CAPTURE_VAULT = vault;
  const event = (from) => ({
    type: 'message',
    action: 'transcribed',
    timestamp: '2026-06-28T20:00:00.000Z',
    context: { from, channelId: 'whatsapp', transcript: 'Note to self: do not store this' },
  });
  process.env.OPENCLAW_OWNER_PHONE = '+10000000000';
  await voiceCapture(event('whatsapp:+10000000001'));
  delete process.env.OPENCLAW_OWNER_PHONE;
  await voiceCapture(event('whatsapp:+10000000000'));
  await assert.rejects(fs.readdir(path.join(vault, 'Inbox', 'Voice')), { code: 'ENOENT' });
});
