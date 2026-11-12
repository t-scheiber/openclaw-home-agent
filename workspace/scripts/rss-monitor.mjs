#!/usr/bin/env node
/**
 * Fetch RSS/Atom feeds and queue new articles for the daily digest.
 * Uses curl with bounded retries and the host resolver.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./lib/state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, "..");
const CONFIG_PATH = join(WORKSPACE, "config", "rss-feeds.json");
const DIGEST_CONFIG_PATH = join(WORKSPACE, "config", "digest.json");
const queueMode = process.argv.includes("--queue");
const digestJsonMode = process.argv.includes("--digest-json");

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function fetchFeed(url) {
  const args = [
    "-sS", "--max-time", "25", "--retry", "2", "--retry-delay", "1",
    "--retry-all-errors", "-L", url,
  ];
  return execFileSync("curl", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
}

export function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)))
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number.parseInt(value, 10)))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
}

export function parseFeed(xml, feedName, maxItems) {
  const items = [];
  const rssItems = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const atomEntries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const blocks = rssItems.length ? rssItems : atomEntries;

  for (const block of blocks.slice(0, maxItems)) {
    const title = decodeEntities(
      block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
    );
    let link =
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ||
      block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ||
      "";
    link = decodeEntities(link.trim());
    const guid =
      block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() ||
      block.match(/<id[^>]*>([\s\S]*?)<\/id>/i)?.[1]?.trim() ||
      link ||
      title;
    if (!title || !link) continue;
    items.push({
      id: `rss:${feedName}:${guid}`.slice(0, 200),
      label: feedName,
      handle: feedName,
      text: title,
      url: link,
      source: "rss",
      createdAt: block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || "",
    });
  }
  return items;
}

function appendToQueue(items) {
  if (!items.length) return;
  const digestCfg = loadJson(DIGEST_CONFIG_PATH, {});
  const queuePath = join(WORKSPACE, digestCfg.queueFile || "memory/digest-queue.json");
  mkdirSync(dirname(queuePath), { recursive: true });
  const queue = loadJson(queuePath, { items: [] });
  queue.items ||= [];
  const known = new Set(queue.items.map((i) => i.id));
  for (const item of items) {
    if (!known.has(item.id)) {
      queue.items.push({ ...item, queuedAt: new Date().toISOString() });
    }
  }
  atomicWriteJson(queuePath, queue);
}

export function roundRobin(groups, limit) {
  const collected = [];
  for (let index = 0; collected.length < limit; index += 1) {
    let added = false;
    for (const items of groups) {
      if (!items[index]) continue;
      collected.push(items[index]);
      added = true;
      if (collected.length >= limit) break;
    }
    if (!added) break;
  }
  return collected;
}

function collectFeedHeadlines(config, { trackSeen = true, state = null } = {}) {
  const maxPerFeed = config.maxItemsPerFeed || 8;
  const maxHeadlines = config.maxHeadlines || 10;
  const byFeed = [];

  for (const feed of config.feeds || []) {
    let xml;
    try {
      xml = fetchFeed(feed.url);
    } catch (err) {
      console.error(`${feed.name}: fetch failed — ${err.message}`);
      continue;
    }
    const parsed = parseFeed(xml, feed.name, maxPerFeed);
    const eligible = [];
    for (const item of parsed) {
      if (trackSeen && state?.seen?.[item.id]) continue;
      if (trackSeen && state) {
        state.seen[item.id] = { at: new Date().toISOString() };
      }
      if ((config.excludeTitlePatterns || []).some((pattern) =>
        item.text.toLowerCase().includes(pattern.toLowerCase()))) continue;
      eligible.push(item);
    }
    byFeed.push(eligible);
  }

  return roundRobin(byFeed, maxHeadlines);
}

function main() {
  const config = loadJson(CONFIG_PATH, { feeds: [] });

  if (digestJsonMode) {
    const headlines = collectFeedHeadlines(config, { trackSeen: false });
    console.log(JSON.stringify({ items: headlines }));
    return;
  }

  const statePath = join(WORKSPACE, config.stateFile || "memory/rss-monitor-state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  const state = loadJson(statePath, { seen: {} });
  state.seen ||= {};

  const allNew = collectFeedHeadlines(config, { trackSeen: true, state });

  const entries = Object.entries(state.seen);
  if (entries.length > 8000) {
    state.seen = Object.fromEntries(entries.slice(-8000));
  }
  atomicWriteJson(statePath, state);

  const headlines = allNew;
  if (!headlines.length) {
    console.error("RSS: 0 new articles");
    if (!queueMode) console.log("NO_REPLY");
    return;
  }

  console.error(`RSS: ${headlines.length} new article(s)`);
  if (queueMode) {
    appendToQueue(headlines);
    console.log("NO_REPLY");
    return;
  }

  const lines = ["**RSS headlines**", ""];
  for (const item of headlines) {
    lines.push(`**${item.label}**`);
    lines.push(item.text);
    lines.push(item.url);
    lines.push("");
  }
  console.log(lines.join("\n").trim());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
