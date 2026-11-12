#!/usr/bin/env node
/**
 * Poll tracked X accounts for headline-style posts.
 * Search mode: 1 API request/day instead of per-account timelines.
 *
 * Modes:
 *   default / --queue  — queue matches for daily digest, print NO_REPLY
 */
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteJson } from "./lib/state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, "..");
const CONFIG_PATH = join(WORKSPACE, "config", "x-monitor.json");
const DIGEST_CONFIG_PATH = join(WORKSPACE, "config", "digest.json");
const XURL = process.env.XURL_BIN || "/home/linuxbrew/.linuxbrew/bin/xurl";
const MAX_QUERY_LEN = 512;
const queueMode = process.argv.includes("--queue");
const digestJsonMode = process.argv.includes("--digest-json");

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function xurlEnv() {
  return { ...process.env, PATH: `/home/linuxbrew/.linuxbrew/bin:${process.env.PATH || ""}` };
}

function runXurl(args) {
  try {
    const out = execFileSync(XURL, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: xurlEnv(),
    });
    return JSON.parse(out);
  } catch (err) {
    const stderr = err.stderr?.toString?.() || "";
    const stdout = err.stdout?.toString?.() || "";
    const msg = (stderr || stdout || err.message).trim();
    throw new Error(msg.slice(0, 300));
  }
}

function authReady() {
  try {
    const status = execFileSync(XURL, ["auth", "status"], {
      encoding: "utf8",
      env: xurlEnv(),
    });
    return !/No apps registered/i.test(status);
  } catch {
    return false;
  }
}

function checkApiAccess() {
  try {
    runXurl(["--app", "openclaw", "--auth", "app", "/2/users/by/username/OpenAI"]);
    return true;
  } catch (err) {
    const out = err.message || "";
    if (/CreditsDepleted|credits/i.test(out)) {
      console.error("X API credits depleted — add credits at https://developer.x.com/en/portal/dashboard");
      return false;
    }
    if (/Unauthorized|401/i.test(out)) {
      console.error("X API unauthorized — check xurl auth (xurl auth status)");
      return false;
    }
    console.error(`X API probe failed: ${out.slice(0, 200)}`);
    return false;
  }
}

function tweetUrl(handle, id) {
  return `https://x.com/${handle}/status/${id}`;
}

function engagementScore(metrics = {}) {
  return (
    (metrics.retweet_count || 0) * 2 +
    (metrics.like_count || 0) +
    (metrics.quote_count || 0) * 3
  );
}

function passesEngagement(metrics, min) {
  if (!min) return true;
  return (
    (metrics.retweet_count || 0) >= (min.retweets || 0) ||
    (metrics.like_count || 0) >= (min.likes || 0)
  );
}

function buildLabelMap(accounts) {
  const map = new Map();
  for (const a of accounts) {
    map.set(a.handle.replace(/^@/, "").toLowerCase(), a.label || a.handle);
  }
  return map;
}

function buildSearchQueries(config) {
  const handles = config.accounts.map((a) => a.handle.replace(/^@/, ""));
  const keywords = (config.searchKeywords || []).join(" OR ");
  const suffix = `-is:retweet -is:reply lang:en`;

  const queries = [];
  let chunk = [];
  for (const handle of handles) {
    const next = [...chunk, handle];
    const fromClause = next.map((h) => `from:${h}`).join(" OR ");
    const candidate = keywords
      ? `(${fromClause}) (${keywords}) ${suffix}`
      : `(${fromClause}) ${suffix}`;
    if (candidate.length > MAX_QUERY_LEN && chunk.length) {
      const fromClauseCur = chunk.map((h) => `from:${h}`).join(" OR ");
      queries.push(
        keywords
          ? `(${fromClauseCur}) (${keywords}) ${suffix}`
          : `(${fromClauseCur}) ${suffix}`,
      );
      chunk = [handle];
    } else {
      chunk = next;
    }
  }
  if (chunk.length) {
    const fromClause = chunk.map((h) => `from:${h}`).join(" OR ");
    queries.push(
      keywords
        ? `(${fromClause}) (${keywords}) ${suffix}`
        : `(${fromClause}) ${suffix}`,
    );
  }
  return queries;
}

function searchHeadlines(config) {
  const maxResults = Math.min(Math.max(config.searchMaxResults || 50, 10), 100);
  const queries = buildSearchQueries(config);
  const labelMap = buildLabelMap(config.accounts);
  const minEngagement = config.minEngagement;
  const maxHeadlines = config.maxHeadlines || 12;
  const byId = new Map();

  for (const query of queries) {
    const encoded = encodeURIComponent(query);
    const path =
      `/2/tweets/search/recent?query=${encoded}` +
      `&max_results=${maxResults}` +
      `&tweet.fields=created_at,public_metrics,author_id` +
      `&expansions=author_id&user.fields=username,name`;
    const resp = runXurl(["--app", "openclaw", "--auth", "app", path]);
    const users = Object.fromEntries(
      (resp.includes?.users || []).map((u) => [u.id, u]),
    );
    for (const tweet of resp.data || []) {
      const metrics = tweet.public_metrics || {};
      if (!passesEngagement(metrics, minEngagement)) continue;
      const user = users[tweet.author_id] || {};
      const handle = user.username || "unknown";
      const label = labelMap.get(handle.toLowerCase()) || user.name || handle;
      byId.set(tweet.id, {
        label,
        handle,
        id: tweet.id,
        text: tweet.text?.trim() || "",
        url: tweetUrl(handle, tweet.id),
        createdAt: tweet.created_at,
        score: engagementScore(metrics),
        metrics,
      });
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, maxHeadlines);
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
      queue.items.push({
        label: item.label,
        handle: item.handle,
        id: item.id,
        text: item.text,
        url: item.url,
        createdAt: item.createdAt,
        queuedAt: new Date().toISOString(),
      });
    }
  }
  atomicWriteJson(queuePath, queue);
}

function formatAlerts(alerts) {
  const lines = ["**X headlines**", ""];
  for (const a of alerts) {
    lines.push(`**${a.label}** (@${a.handle})`);
    lines.push(a.text);
    lines.push(a.url);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function main() {
  if (!digestJsonMode) {
    if (!existsSync(XURL)) {
      console.error(`xurl not found at ${XURL}`);
      console.log("NO_REPLY");
      process.exit(0);
    }
    if (!authReady()) {
      console.error("xurl is not authenticated — see X-MONITOR.md");
      console.log("NO_REPLY");
      process.exit(0);
    }
    if (!checkApiAccess()) {
      console.log("NO_REPLY");
      process.exit(0);
    }
  }

  const config = loadJson(CONFIG_PATH, null);
  if (digestJsonMode) {
    if (!config?.accounts?.length || !existsSync(XURL) || !authReady() || !checkApiAccess()) {
      console.log(JSON.stringify({ items: [] }));
      return;
    }
    const candidates = config.mode === "search" ? searchHeadlines(config) : [];
    console.log(JSON.stringify({ items: candidates }));
    return;
  }

  if (!config?.accounts?.length) {
    console.error("Missing config at config/x-monitor.json");
    console.log("NO_REPLY");
    process.exit(0);
  }

  const statePath = join(WORKSPACE, config.stateFile || "memory/x-monitor-state.json");
  mkdirSync(dirname(statePath), { recursive: true });
  const state = loadJson(statePath, { seen: {} });
  state.seen ||= {};

  const candidates =
    config.mode === "search" ? searchHeadlines(config) : [];

  const alerts = candidates.filter((item) => {
    if (state.seen[item.id]) return false;
    state.seen[item.id] = { handle: item.handle, alerted: true, at: new Date().toISOString() };
    return true;
  });

  const entries = Object.entries(state.seen);
  if (entries.length > 5000) {
    state.seen = Object.fromEntries(entries.slice(-5000));
  }
  atomicWriteJson(statePath, state);

  if (!alerts.length) {
    console.error(`Search mode: 0 new headlines (${candidates.length} candidates)`);
    console.log("NO_REPLY");
    return;
  }

  console.error(
    `Search mode: ${alerts.length} new headline(s) (${buildSearchQueries(config).length} API request(s))`,
  );

  if (queueMode) {
    appendToQueue(alerts);
    console.log("NO_REPLY");
    return;
  }

  console.log(formatAlerts(alerts));
}

main();
