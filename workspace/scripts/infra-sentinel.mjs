#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJson } from './lib/state.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(workspace, 'config/infra-sentinel.json'), 'utf8'));
const statePath = path.join(workspace, 'memory/infra-sentinel-state.json');
const reportPath = path.join(workspace, 'memory/infra-sentinel-report.json');
const notify = process.argv.includes('--notify');
const whatsappTarget = process.env.OPENCLAW_OWNER_PHONE || config.whatsappTo;

async function checkHttp(entry) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs || 8000);
  try {
    const response = await fetch(entry.url, { redirect: 'manual', signal: controller.signal });
    return { ...entry, ok: response.status >= 200 && response.status < 400, status: response.status };
  } catch (error) {
    return { ...entry, ok: false, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

function checkTcp(entry) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: entry.host, port: entry.port });
    const finish = (result) => { socket.destroy(); resolve({ ...entry, ...result }); };
    socket.setTimeout(config.timeoutMs || 8000);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error: 'timeout' }));
    socket.once('error', (error) => finish({ ok: false, error: error.message }));
  });
}

function checkService(name) {
  try {
    const state = execFileSync('systemctl', ['is-active', name], { encoding: 'utf8' }).trim();
    return { name, ok: state === 'active', state };
  } catch (error) {
    return { name, ok: false, state: String(error.stdout || '').trim() || 'unknown' };
  }
}

function diskStatus() {
  const line = execFileSync('df', ['-P', '/home/openclaw'], { encoding: 'utf8' }).trim().split('\n').at(-1);
  const columns = line.trim().split(/\s+/);
  const percent = Number(columns[4].replace('%', ''));
  return { name: 'OpenClaw disk', ok: percent < config.diskWarningPercent, percent };
}

function alertText(check) {
  const detail = check.status ?? check.state ?? check.percent ?? check.error ?? 'failed';
  return `${check.name}: ${detail}`;
}

const checks = [
  ...await Promise.all((config.http || []).map(checkHttp)),
  ...await Promise.all((config.tcp || []).map(checkTcp)),
  ...(config.localServices || []).map(checkService),
  diskStatus(),
];
const alerts = checks.filter((check) => !check.ok).map(alertText);
const report = { checkedAt: new Date().toISOString(), ok: alerts.length === 0, alerts, checks };
atomicWriteJson(reportPath, report);

let previous = {};
try { previous = JSON.parse(await fs.readFile(statePath, 'utf8')); } catch {}
const signature = JSON.stringify(alerts.toSorted());
if (notify && signature !== previous.signature) {
  const message = alerts.length
    ? `OpenClaw infrastructure alert:\n- ${alerts.join('\n- ')}`
    : 'OpenClaw infrastructure recovered: all monitored checks are healthy.';
  if (!whatsappTarget) {
    console.error('No alert target: set OPENCLAW_OWNER_PHONE or whatsappTo in the config.');
  } else {
    const result = spawnSync('openclaw', [
      'message', 'send', '--channel', 'whatsapp', '--target', whatsappTarget,
      '--message', message,
    ], { encoding: 'utf8' });
    if (result.status !== 0) console.error(result.stderr || result.stdout);
  }
}
atomicWriteJson(statePath, { signature, checkedAt: report.checkedAt });
console.log(JSON.stringify(report));
process.exitCode = report.ok ? 0 : 2;

