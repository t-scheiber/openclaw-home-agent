import 'dotenv/config';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Parser from 'rss-parser';
import PDFDocument from 'pdfkit';
import nodemailer from 'nodemailer';
import OpenAI from 'openai';
import { htmlToText } from 'html-to-text';
import { diversifySections } from './content.js';

const TZ = process.env.TZ || 'Europe/Berlin';
const OUT_DIR = process.env.DIGEST_OUT_DIR || path.join(process.cwd(), 'output');
const OPENCLAW_WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const BREW_BIN = '/home/linuxbrew/.linuxbrew/bin';
const MAX_ITEMS_PER_SECTION = Number(process.env.MAX_ITEMS_PER_SECTION || 7);
const SUMMARY_ITEMS_PER_SECTION = Number(process.env.SUMMARY_ITEMS_PER_SECTION || 5);
const MIN_DIGEST_ITEMS = Number(process.env.MIN_DIGEST_ITEMS || 5);
const EXCLUDE_PATTERNS = (process.env.EXCLUDE_TITLE_PATTERNS ||
  'prime day|black friday|best deals|deal of the day|discounted')
  .split('|').map((value) => value.trim()).filter(Boolean);

const feeds = [
  {
    section: 'World Headlines',
    url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en'
  },
  {
    section: 'Business and Markets',
    url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en'
  },
  {
    section: 'Technology',
    url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en'
  },
  {
    section: 'AI',
    url: 'https://news.google.com/rss/search?q=(artificial%20intelligence%20OR%20OpenAI%20OR%20Anthropic%20OR%20Google%20DeepMind%20OR%20Nvidia)%20when:1d&hl=en-US&gl=US&ceid=US:en'
  },
];

// Optional local sections. Set DIGEST_COUNTRY and DIGEST_COUNTRY_CODE for a country feed,
// and DIGEST_CITY on top of that for a city feed. Without them the digest has no local sections.
const COUNTRY = process.env.DIGEST_COUNTRY || '';
const COUNTRY_CODE = (process.env.DIGEST_COUNTRY_CODE || '').toUpperCase();
const CITY = process.env.DIGEST_CITY || '';
if (COUNTRY && /^[A-Z]{2}$/.test(COUNTRY_CODE)) {
  const locale = `hl=en-${COUNTRY_CODE}&gl=${COUNTRY_CODE}&ceid=${COUNTRY_CODE}:en`;
  feeds.push({
    section: COUNTRY,
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(COUNTRY)}%20when:1d&${locale}`
  });
  if (CITY) {
    feeds.push({
      section: CITY,
      url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${CITY} ${COUNTRY}`)}%20when:1d&${locale}`
    });
  }
}

function todayStamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readableDate() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date());
}

function cleanText(input = '') {
  return htmlToText(input, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  })
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/ - [^-]+$/, '')
    .trim();
}

function truncateForSpeech(text = '', max = 320) {
  const cleaned = cleanText(text);
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const end = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${end.trim()}…`;
}

function sourceFromItem(item) {
  const source = item.source?.title || item.creator || item.author || '';
  if (source) return cleanText(source);
  try {
    return new URL(item.link).hostname.replace(/^www\./, '');
  } catch {
    return 'Unknown source';
  }
}

function runOpenClawScript(scriptName, flag) {
  return spawnSync('node', [path.join(OPENCLAW_WORKSPACE, 'scripts', scriptName), flag], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${BREW_BIN}:${process.env.PATH || ''}` }
  });
}

function mapItemsToSection(name, items, sourceFn) {
  return {
    name,
    items: (items || []).map((item) => ({
      title: cleanText(item.text || item.title || ''),
      link: item.url || item.link || '',
      source: sourceFn(item),
      published: item.createdAt || item.published || '',
      context: cleanText(item.context || '')
    })).filter((item) => item.title && item.link)
  };
}

function fetchOpenClawSections() {
  const sections = [];

  const x = runOpenClawScript('x-monitor.mjs', '--digest-json');
  if (x.status === 0 && x.stdout.trim()) {
    try {
      const { items } = JSON.parse(x.stdout);
      const section = mapItemsToSection('Tech on X', items, (item) => item.label || `@${item.handle}`);
      if (section.items.length) sections.push(section);
    } catch (error) {
      console.warn(`X monitor section skipped: ${error.message}`);
    }
  } else if (x.stderr) {
    console.warn(x.stderr.trim());
  }

  const rss = runOpenClawScript('rss-monitor.mjs', '--digest-json');
  if (rss.status === 0 && rss.stdout.trim()) {
    try {
      const { items } = JSON.parse(rss.stdout);
      const section = mapItemsToSection('Tech RSS', items, (item) => item.label || 'RSS');
      if (section.items.length) sections.push(section);
    } catch (error) {
      console.warn(`RSS monitor section skipped: ${error.message}`);
    }
  } else if (rss.stderr) {
    console.warn(rss.stderr.trim());
  }

  return sections;
}

async function fetchSections() {
  const parser = new Parser({
    timeout: 20000,
    headers: {
      'User-Agent': 'OpenClaw daily news digest/1.0'
    }
  });
  const seen = new Set();
  const sections = [];

  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = [];
      for (const item of parsed.items || []) {
        const title = cleanText(item.title);
        const link = item.link || item.guid || '';
        const key = `${title.toLowerCase()}|${link}`;
        if (!title || seen.has(key)) continue;
        seen.add(key);
        items.push({
          title,
          link,
          source: sourceFromItem(item),
          published: item.isoDate || item.pubDate || '',
          context: cleanText(item.contentSnippet || item.content || item.summary || '')
        });
        if (items.length >= MAX_ITEMS_PER_SECTION) break;
      }
      sections.push({ name: feed.section, items });
    } catch (error) {
      sections.push({
        name: feed.section,
        items: [],
        error: error.message
      });
    }
  }

  return sections;
}

function fallbackSummary(sections) {
  return sections.map((section) => ({
    name: section.name,
    overview: section.error
      ? `Could not fetch this section: ${section.error}`
      : `Top ${Math.min(section.items.length, SUMMARY_ITEMS_PER_SECTION)} current items in ${section.name.toLowerCase()}.`,
    items: section.items.slice(0, SUMMARY_ITEMS_PER_SECTION).map((item) => ({
      headline: truncateForSpeech(item.title, 200),
      context: truncateForSpeech(item.context || `Reported by ${item.source}.`, 320),
      source: item.source
    }))
  }));
}

async function aiSummary(sections) {
  if (!process.env.OPENAI_API_KEY) return fallbackSummary(sections);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const input = sections.map((section) => ({
    name: section.name,
    items: section.items.slice(0, MAX_ITEMS_PER_SECTION)
  }));

  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.5',
    input: [
      {
        role: 'system',
        content: 'You create concise daily news digests. Stay factual, avoid sensationalism, and do not invent facts beyond the supplied RSS items.'
      },
      {
        role: 'user',
        content: `Create a JSON digest from these current news RSS items. For each section choose up to ${SUMMARY_ITEMS_PER_SECTION} important items. Use this exact shape: {"sections":[{"name":"Section","overview":"1 sentence","items":[{"headline":"...","context":"1-2 sentences","source":"..."}]}]}. Do not include URLs. Items: ${JSON.stringify(input)}`
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'daily_news_digest',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sections'],
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'overview', 'items'],
                properties: {
                  name: { type: 'string' },
                  overview: { type: 'string' },
                  items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['headline', 'context', 'source'],
                      properties: {
                        headline: { type: 'string' },
                        context: { type: 'string' },
                        source: { type: 'string' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const text = response.output_text;
  return JSON.parse(text).sections.map((section) => ({
    ...section,
    items: (section.items || []).map((item) => ({
      headline: truncateForSpeech(item.headline, 200),
      context: truncateForSpeech(item.context, 320),
      source: item.source
    }))
  }));
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function pageBottom(doc) {
  return doc.page.height - doc.page.margins.bottom;
}

function ensureSpace(doc, height) {
  const buffer = 8;
  if (doc.y + height + buffer > pageBottom(doc)) {
    doc.addPage();
  }
}

function renderBlock(doc, text, style = {}) {
  const width = contentWidth(doc);
  const lineGap = style.lineGap ?? 3;
  const font = style.font || 'Helvetica';
  const size = style.size || 10;

  doc.font(font).fontSize(size);
  if (style.color) doc.fillColor(style.color);

  const height = doc.heightOfString(text || '', { width, lineGap });
  ensureSpace(doc, height + (style.afterGap || 0));

  doc.text(text || '', {
    width,
    lineGap,
    continued: false
  });

  if (style.afterGap) doc.moveDown(style.afterGap);
}

async function createPdf(summary, sections, filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const doc = new PDFDocument({
    size: 'A4',
    margin: 54,
    info: {
      Title: `Daily News Digest ${todayStamp()}`,
      Author: 'OpenClaw Daily News Digest'
    }
  });

  const stream = fsSync.createWriteStream(filePath);
  doc.pipe(stream);

  renderBlock(doc, 'Daily News Digest', { font: 'Helvetica-Bold', size: 22, color: '#111', afterGap: 0.35 });
  renderBlock(doc, readableDate(), { size: 10, color: '#555', afterGap: 1 });
  renderBlock(doc, 'Prepared for listening in Speechify. Headlines and summaries only — no links.', {
    size: 11,
    color: '#222',
    afterGap: 1.2
  });

  for (const section of summary) {
    renderBlock(doc, section.name, { font: 'Helvetica-Bold', size: 16, color: '#111', afterGap: 0.25 });
    renderBlock(doc, section.overview || '', {
      font: 'Helvetica-Oblique',
      size: 10,
      color: '#444',
      afterGap: 0.6
    });

    for (const item of section.items || []) {
      renderBlock(doc, item.headline, { font: 'Helvetica-Bold', size: 12, color: '#111', afterGap: 0.15 });
      const context = (item.context || '').trim();
      const isSourceOnly = /^Reported by .+\.$/i.test(context);
      if (context && !isSourceOnly) {
        renderBlock(doc, context, { size: 10, color: '#333', afterGap: 0.12 });
      }
      renderBlock(doc, `Source: ${item.source || 'Unknown'}`, { size: 9, color: '#666', afterGap: 0.55 });
    }
    doc.moveDown(0.35);
  }

  const failed = sections.filter((section) => section.error);
  if (failed.length) {
    renderBlock(doc, 'Fetch Notes', { font: 'Helvetica-Bold', size: 12, color: '#111', afterGap: 0.25 });
    for (const section of failed) {
      renderBlock(doc, `${section.name}: ${section.error}`, { size: 9, color: '#555', afterGap: 0.2 });
    }
  }

  doc.end();

  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function uploadToDrive(filePath) {
  const remote = process.env.RCLONE_REMOTE_PATH;
  if (!remote) return null;

  const result = spawnSync('rclone', ['copyto', filePath, `${remote}/${path.basename(filePath)}`], {
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    throw new Error(`rclone upload failed: ${result.stderr || result.stdout}`);
  }

  const publicBaseUrl = process.env.PUBLIC_DIGEST_BASE_URL;
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(path.basename(filePath))}`;
  }

  return `${remote}/${path.basename(filePath)}`;
}

async function sendEmail({ pdfPath, uploadTarget }) {
  if (!process.env.SMTP_HOST || !process.env.MAIL_TO || !process.env.MAIL_FROM) {
    console.log('Email skipped: SMTP_HOST, MAIL_TO, and MAIL_FROM are required.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || ''
        }
      : undefined
  });

  const date = todayStamp();
  const targetText = uploadTarget || 'the attached PDF';
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: process.env.MAIL_TO,
    subject: `Daily news digest ready - ${date}`,
    text: [
      `Your daily news digest for ${date} is ready.`,
      '',
      `Speechify source: ${targetText}`,
      '',
      'If Speechify does not auto-import it, open Speechify and import the PDF from the configured Google Drive folder.'
    ].join('\n'),
    attachments: process.env.EMAIL_ATTACH_PDF === 'true'
      ? [{ filename: path.basename(pdfPath), path: pdfPath }]
      : []
  });
}

async function sendWhatsApp({ stamp, uploadTarget }) {
  const to = process.env.WHATSAPP_TO;
  if (process.env.WHATSAPP_NOTIFY !== 'true' || !to) {
    console.log('WhatsApp skipped: set WHATSAPP_NOTIFY=true and WHATSAPP_TO.');
    return;
  }

  const message = [
    `Daily news digest ready for ${stamp}.`,
    uploadTarget ? `Google Drive: ${uploadTarget}` : '',
    'Open in Speechify when convenient.'
  ].filter(Boolean).join('\n');

  const result = spawnSync(
    'openclaw',
    ['message', 'send', '--channel', 'whatsapp', '--target', to, '--message', message],
    { encoding: 'utf8' }
  );

  if (result.status !== 0) {
    console.warn(`WhatsApp notify failed: ${result.stderr || result.stdout}`);
    return;
  }
  console.log('WhatsApp notification sent.');
}

function copyToObsidian(pdfPath, stamp) {
  const vault = process.env.OBSIDIAN_VAULT_DIR;
  if (!vault) return;
  const destDir = path.join(vault, process.env.OBSIDIAN_SPEECHIFY_SUBDIR || 'Daily/Speechify');
  fsSync.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, `daily-news-digest-${stamp}.pdf`);
  fsSync.copyFileSync(pdfPath, dest);
  console.log(`Obsidian copy: ${dest}`);
}

async function main() {
  const startedAt = new Date().toISOString();
  await fs.mkdir(OUT_DIR, { recursive: true });
  const stamp = todayStamp();
  const pdfPath = path.join(OUT_DIR, `daily-news-digest-${stamp}.pdf`);

  console.log(`Fetching news for ${stamp}...`);
  const openClawSections = fetchOpenClawSections();
  const newsSections = await fetchSections();
  const sections = diversifySections([...openClawSections, ...newsSections], {
    limit: MAX_ITEMS_PER_SECTION,
    maxPerSource: 2,
    excludePatterns: EXCLUDE_PATTERNS,
  });
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const sourceErrors = sections.filter((section) => section.error)
    .map((section) => ({ section: section.name, error: section.error }));
  console.log(`Selected ${itemCount} diverse items (${openClawSections.length} OpenClaw sections).`);
  if (itemCount < MIN_DIGEST_ITEMS) {
    throw new Error(`Digest preflight failed: only ${itemCount} items available; minimum is ${MIN_DIGEST_ITEMS}.`);
  }

  let summary;
  try {
    summary = await aiSummary(sections);
  } catch (error) {
    console.warn(`AI summary failed, using fallback: ${error.message}`);
    summary = fallbackSummary(sections);
  }

  await createPdf(summary, sections, pdfPath);
  console.log(`PDF written: ${pdfPath}`);

  let uploadTarget = null;
  if (process.env.RCLONE_REMOTE_PATH) {
    uploadTarget = uploadToDrive(pdfPath);
    console.log(`Uploaded: ${uploadTarget}`);
  } else {
    console.log('Upload skipped: RCLONE_REMOTE_PATH is not configured.');
  }

  await sendEmail({ pdfPath, uploadTarget });
  copyToObsidian(pdfPath, stamp);
  await sendWhatsApp({ stamp, uploadTarget });
  await writeStatus({
    ok: true,
    stamp,
    startedAt,
    finishedAt: new Date().toISOString(),
    itemCount,
    sourceErrors,
    outputs: { pdfPath, uploadTarget },
  });
  console.log('Done.');
}

async function writeStatus(status) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const target = path.join(OUT_DIR, 'status.json');
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, target);
}

main().catch(async (error) => {
  console.error(error);
  try {
    await writeStatus({ ok: false, finishedAt: new Date().toISOString(), error: error.message });
  } catch (statusError) {
    console.error(`Could not write digest status: ${statusError.message}`);
  }
  process.exitCode = 1;
});
