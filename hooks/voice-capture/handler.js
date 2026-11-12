import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CAPTURE_PREFIX = /^(obsidian|note to self|capture|remember this|task)\s*[:,-]?\s*/i;

// The owner number comes from the environment only. With no number configured
// nobody matches, so the hook never writes anything for an unknown sender.
function ownerMatches(from) {
  const owner = String(process.env.OPENCLAW_OWNER_PHONE || '').replace(/\D/g, '');
  if (!owner) return false;
  return String(from || '').replace(/\D/g, '').endsWith(owner);
}

export default async function voiceCapture(event) {
  if (event.type !== 'message' || event.action !== 'transcribed') return;
  const context = event.context || {};
  const transcript = String(context.transcript || '').trim();
  if (!ownerMatches(context.from) || !CAPTURE_PREFIX.test(transcript)) return;

  const content = transcript.replace(CAPTURE_PREFIX, '').trim();
  if (!content) return;
  const vault = process.env.VOICE_CAPTURE_VAULT || path.join(os.homedir(), 'Obsidian', 'Vault');
  const inbox = path.join(vault, 'Inbox', 'Voice');
  await fs.mkdir(inbox, { recursive: true });

  const now = new Date(event.timestamp || Date.now());
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = path.join(inbox, `${stamp}.md`);
  const note = [
    '# Voice capture',
    '',
    `- Captured: ${now.toISOString()}`,
    `- Source: ${context.channelId || 'whatsapp'}`,
    '',
    content,
    '',
  ].join('\n');
  await fs.writeFile(target, note, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
