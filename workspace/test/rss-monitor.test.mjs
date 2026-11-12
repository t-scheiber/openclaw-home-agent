import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, parseFeed, roundRobin } from "../scripts/rss-monitor.mjs";

test("decodeEntities handles named, decimal, and hexadecimal entities", () => {
  assert.equal(
    decodeEntities("Apple&#8217;s &amp; OpenAI&#x2019;s news"),
    "Apple’s & OpenAI’s news",
  );
});

test("parseFeed extracts a clean RSS item", () => {
  const xml = `
    <rss><channel><item>
      <title>New &amp; useful</title>
      <link>https://example.com/item</link>
      <guid>abc</guid>
      <pubDate>Sun, 28 Jun 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
  assert.deepEqual(parseFeed(xml, "Example", 5), [{
    id: "rss:Example:abc",
    label: "Example",
    handle: "Example",
    text: "New & useful",
    url: "https://example.com/item",
    source: "rss",
    createdAt: "Sun, 28 Jun 2026 10:00:00 GMT",
  }]);
});

test("roundRobin prevents one source from dominating", () => {
  assert.deepEqual(
    roundRobin([["a1", "a2", "a3"], ["b1", "b2"], ["c1"]], 5),
    ["a1", "b1", "c1", "a2", "b2"],
  );
});

