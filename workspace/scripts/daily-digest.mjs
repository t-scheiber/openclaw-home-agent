#!/usr/bin/env node
/**
 * Build the daily tech digest from queued X + RSS items.
 * Archives markdown, Speechify-optimized PDF + reader text, uploads PDF to Google Drive.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReaderDocument,
  writeReaderPdf,
} from "./digest-to-pdf.mjs";
import { atomicWriteJson } from "./lib/state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(__dirname, "..");
const CONFIG_PATH = join(WORKSPACE, "config", "digest.json");
const XMONITOR = join(WORKSPACE, "scripts", "x-monitor.mjs");
const RSSMONITOR = join(WORKSPACE, "scripts", "rss-monitor.mjs");
const BREW_PATH = "/home/linuxbrew/.linuxbrew/bin";

function loadJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function envWithBrew() {
  return { ...process.env, PATH: `${BREW_PATH}:${process.env.PATH || ""}` };
}

function dateInTz(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatDateHeading(timezone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

function truncateForWhatsApp(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20).trimEnd()}\n\n… (truncated)`;
}

function runScript(script, args = []) {
  try {
    execFileSync("node", [script, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: envWithBrew(),
    });
  } catch (err) {
    const stderr = err.stderr?.toString?.() || "";
    if (stderr) console.error(stderr.trim());
  }
}

function formatXItem(item, index) {
  const lines = [`${index}. *${item.label}* (@${item.handle})`];
  const text = item.text.replace(/\s+/g, " ").trim();
  const snippet = text.length > 220 ? `${text.slice(0, 217)}…` : text;
  lines.push(snippet);
  lines.push(item.url);
  return lines.join("\n");
}

function formatRssItem(item, index) {
  const lines = [`${index}. *${item.label}*`];
  const title = item.text.replace(/\s+/g, " ").trim();
  const snippet = title.length > 220 ? `${title.slice(0, 217)}…` : title;
  lines.push(snippet);
  lines.push(item.url);
  return lines.join("\n");
}

function oneLineSummary(xItems, rssItems) {
  const parts = [];
  for (const item of [...xItems, ...rssItems].slice(0, 4)) {
    parts.push(item.label || item.handle);
  }
  if (!parts.length) return "";
  const rest = xItems.length + rssItems.length - parts.length;
  const suffix = rest > 0 ? ` +${rest} more` : "";
  return `Today: ${parts.join(", ")}${suffix}`;
}

function writeArchive(config, day, dateLabel, xItems, rssItems) {
  const heading = config.title || "Daily tech digest";
  const workspaceArchive = join(
    WORKSPACE,
    config.archiveDir || "memory/digests",
  );
  mkdirSync(workspaceArchive, { recursive: true });

  const sections = [`# ${heading}`, "", `_${dateLabel}_`, ""];
  if (xItems.length) {
    sections.push("## X / Twitter", "");
    for (const [i, item] of xItems.entries()) {
      sections.push(
        [`### ${i + 1}. ${item.label} (@${item.handle})`, "", item.text, "", item.url, ""]
          .filter(Boolean)
          .join("\n"),
      );
    }
  }
  if (rssItems.length) {
    sections.push("## RSS", "");
    for (const [i, item] of rssItems.entries()) {
      sections.push(
        [`### ${i + 1}. ${item.label}`, "", item.text, "", item.url, ""].join("\n"),
      );
    }
  }
  const archive = sections.join("\n");
  writeFileSync(join(workspaceArchive, `${day}.md`), archive);
  console.error(`Archive: ${join(workspaceArchive, `${day}.md`)}`);
  return archive;
}

function writeSpeechifyArtifacts(config, day, payload, readerText) {
  const pdfDir = join(
    WORKSPACE,
    config.pdf?.dir || "memory/digests/pdf",
  );
  mkdirSync(pdfDir, { recursive: true });
  const baseName = `${day} Daily tech digest`;
  const pdfPath = join(pdfDir, `${baseName}.pdf`);
  const readerPath = join(pdfDir, `${baseName}.reader.txt`);

  writeFileSync(readerPath, readerText);
  console.error(`Reader text: ${readerPath}`);

  const obsidianRoot = config.obsidian?.vaultDir;
  if (obsidianRoot) {
    const speechifyDir = join(
      obsidianRoot,
      config.speechify?.obsidianSubdir || "Daily/Speechify",
    );
    mkdirSync(speechifyDir, { recursive: true });
    writeFileSync(join(speechifyDir, `${baseName}.reader.txt`), readerText);
    console.error(`Obsidian reader: ${join(speechifyDir, `${baseName}.reader.txt`)}`);
  }

  return { pdfPath, baseName };
}

function uploadPdfToDrive(config, pdfPath, baseName) {
  const gdrive = config.googleDrive;
  if (!gdrive?.enabled) return;
  const remote = gdrive.remote || "gdrive:OpenClaw/Daily digests";
  const dest = `${remote}/${baseName}.pdf`;
  try {
    execFileSync(
      "rclone",
      ["copyto", pdfPath, dest, "--stats-one-line"],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 120000 },
    );
    console.error(`Google Drive: ${dest}`);
  } catch (err) {
    const msg = err.stderr?.toString?.() || err.message;
    console.error(`Google Drive upload failed: ${msg.trim()}`);
  }
}

async function main() {
  const config = loadJson(CONFIG_PATH, {});
  const timezone = config.timezone || "Europe/Berlin";
  const queuePath = join(WORKSPACE, config.queueFile || "memory/digest-queue.json");
  const maxChars = config.maxWhatsAppChars || 3500;

  runScript(XMONITOR, ["--queue"]);
  runScript(RSSMONITOR, ["--queue"]);

  const queue = loadJson(queuePath, { items: [] });
  const items = queue.items || [];
  const xItems = items.filter((i) => i.source !== "rss");
  const rssItems = items.filter((i) => i.source === "rss");

  if (!items.length) {
    console.error("Daily digest: nothing queued");
    console.log("NO_REPLY");
    return;
  }

  const heading = config.title || "Daily tech digest";
  const dateLabel = formatDateHeading(timezone);
  const summary = oneLineSummary(xItems, rssItems);
  const day = dateInTz(timezone);

  writeArchive(config, day, dateLabel, xItems, rssItems);

  const readerPayload = {
    title: heading,
    dateLabel,
    summary,
    xItems,
    rssItems,
  };
  const readerText = buildReaderDocument(readerPayload);

  if (config.pdf?.enabled !== false) {
    const { pdfPath, baseName } = writeSpeechifyArtifacts(
      config,
      day,
      readerPayload,
      readerText,
    );
    await writeReaderPdf({
      title: heading,
      dateLabel,
      readerText,
      outputPath: pdfPath,
    });
    console.error(`PDF: ${pdfPath}`);

    if (obsidianVault(config)) {
      const speechifyDir = join(
        obsidianVault(config),
        config.speechify?.obsidianSubdir || "Daily/Speechify",
      );
      mkdirSync(speechifyDir, { recursive: true });
      const obsidianPdf = join(speechifyDir, `${baseName}.pdf`);
      execFileSync("cp", [pdfPath, obsidianPdf]);
      console.error(`Obsidian PDF: ${obsidianPdf}`);
    }

    uploadPdfToDrive(config, pdfPath, baseName);
  }

  atomicWriteJson(queuePath, {
    items: [],
    lastDigestAt: new Date().toISOString(),
    lastDigestDay: day,
  });

  const lines = [`*${heading}*`, dateLabel];
  if (summary) lines.push(`_${summary}_`);
  lines.push("");
  if (xItems.length) {
    lines.push(`*X / Twitter* (${xItems.length})`, "");
    xItems.forEach((item, i) => {
      lines.push(formatXItem(item, i + 1));
      lines.push("");
    });
  }
  if (rssItems.length) {
    lines.push(`*RSS* (${rssItems.length})`, "");
    rssItems.forEach((item, i) => {
      lines.push(formatRssItem(item, i + 1));
      lines.push("");
    });
  }
  if (config.googleDrive?.enabled) {
    lines.push("_PDF uploaded to Google Drive for Speechify._", "");
  }

  console.log(truncateForWhatsApp(lines.join("\n").trim(), maxChars));
}

function obsidianVault(config) {
  return config.obsidian?.vaultDir || null;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
