#!/usr/bin/env node
/**
 * Build screen-reader / Speechify friendly digest text and PDF.
 * - Linear structure, numbered items, URLs on their own line (never inline).
 * - No markdown bold/asterisks in the reading copy.
 */
import { createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const PDFDocument = require(join(__dirname, "..", "node_modules", "pdfkit"));

export function shortLinkLabel(url) {
  try {
    const u = new URL(url);
    let host = u.hostname.replace(/^www\./, "");
    let path = u.pathname + u.search;
    if (path === "/") path = "";
    const label = path ? `${host}${path}` : host;
    return label.length > 72 ? `${label.slice(0, 69)}…` : label;
  } catch {
    const t = url.trim();
    return t.length > 72 ? `${t.slice(0, 69)}…` : t;
  }
}

export function buildReaderDocument({ title, dateLabel, summary, xItems, rssItems }) {
  const lines = [title, dateLabel, ""];
  if (summary) {
    lines.push(summary.replace(/^\*|\*$/g, "").replace(/^_|_$/g, ""));
    lines.push("");
  }

  if (xItems.length) {
    lines.push("Section: X and Twitter", "");
    xItems.forEach((item, i) => {
      lines.push(`Item ${i + 1}. ${item.label}`);
      lines.push("");
      lines.push(item.text.replace(/\s+/g, " ").trim());
      lines.push("");
      lines.push(`Link label: ${shortLinkLabel(item.url)}`);
      lines.push(`Full address: ${item.url}`);
      lines.push("");
    });
  }

  if (rssItems.length) {
    lines.push("Section: RSS news", "");
    rssItems.forEach((item, i) => {
      lines.push(`Item ${i + 1}. ${item.label}`);
      lines.push("");
      lines.push(item.text.replace(/\s+/g, " ").trim());
      lines.push("");
      lines.push(`Link label: ${shortLinkLabel(item.url)}`);
      lines.push(`Full address: ${item.url}`);
      lines.push("");
    });
  }

  return lines.join("\n").trim();
}

export function writeReaderPdf({ title, dateLabel, readerText, outputPath }) {
  mkdirSync(dirname(outputPath), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 56,
      info: {
        Title: title,
        Author: "OpenClaw Daily Digest",
        Subject: dateLabel,
      },
    });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);

    const paragraphs = readerText.split(/\n\n+/);
    let first = true;
    for (const block of paragraphs) {
      const text = block.trim();
      if (!text) continue;

      if (first) {
        doc.font("Helvetica-Bold").fontSize(20).text(text, { lineGap: 4 });
        first = false;
        doc.moveDown(0.5);
        continue;
      }

      if (text.startsWith("Section:")) {
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold").fontSize(16).text(text.replace(/^Section:\s*/, ""), {
          lineGap: 3,
        });
        doc.moveDown(0.3);
        continue;
      }

      if (/^Item \d+\./.test(text)) {
        doc.font("Helvetica-Bold").fontSize(13).text(text, { lineGap: 3 });
        continue;
      }

      if (text.startsWith("Link label:") || text.startsWith("Full address:")) {
        doc.font("Helvetica").fontSize(11).fillColor("#333333").text(text, { lineGap: 2 });
        doc.fillColor("#000000");
        continue;
      }

      doc.font("Helvetica").fontSize(12).text(text, {
        lineGap: 4,
        align: "left",
      });
      doc.moveDown(0.35);
    }

    doc.end();
    stream.on("finish", () => resolve(outputPath));
    stream.on("error", reject);
    doc.on("error", reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf("--input");
  const outIdx = args.indexOf("--output");
  if (inIdx < 0 || outIdx < 0) {
    console.error("Usage: digest-to-pdf.mjs --input data.json --output file.pdf");
    process.exit(1);
  }
  const { readFileSync } = await import("node:fs");
  const data = JSON.parse(readFileSync(args[inIdx + 1], "utf8"));
  const readerText = buildReaderDocument(data);
  await writeReaderPdf({
    title: data.title,
    dateLabel: data.dateLabel,
    readerText,
    outputPath: args[outIdx + 1],
  });
  console.error(`PDF: ${args[outIdx + 1]}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
