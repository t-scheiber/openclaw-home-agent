const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'in', 'is', 'it',
  'of', 'on', 'or', 'that', 'the', 'this', 'to', 'with', 'says', 'report',
]);

export function titleTokens(title = '') {
  return new Set(title.toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token)));
}

export function titleSimilarity(left, right) {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.min(a.size, b.size);
}

export function selectDiverseItems(items, {
  limit = 7,
  maxPerSource = 2,
  excludePatterns = [],
  seenTitles = [],
  similarityThreshold = 0.72,
} = {}) {
  const selected = [];
  const sourceCounts = new Map();
  const knownTitles = [...seenTitles];

  for (const item of items || []) {
    const title = item.title || '';
    const lowered = title.toLowerCase();
    if (excludePatterns.some((pattern) => lowered.includes(pattern.toLowerCase()))) continue;
    if (knownTitles.some((known) => titleSimilarity(title, known) >= similarityThreshold)) continue;
    const source = (item.source || 'Unknown source').toLowerCase();
    if ((sourceCounts.get(source) || 0) >= maxPerSource) continue;
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    selected.push(item);
    knownTitles.push(title);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function diversifySections(sections, options = {}) {
  const seenTitles = [];
  return sections.map((section) => {
    const items = selectDiverseItems(section.items, { ...options, seenTitles });
    seenTitles.push(...items.map((item) => item.title));
    return { ...section, items };
  });
}

