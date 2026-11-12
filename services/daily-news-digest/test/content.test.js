import test from 'node:test';
import assert from 'node:assert/strict';
import { diversifySections, selectDiverseItems, titleSimilarity } from '../src/content.js';

test('titleSimilarity detects the same story with different wording', () => {
  assert.ok(titleSimilarity(
    'OpenAI launches a faster coding model today',
    'OpenAI launches faster coding model',
  ) >= 0.72);
});

test('selectDiverseItems enforces source quotas and filters deals', () => {
  const items = [
    { title: 'Prime Day best deals', source: 'A' },
    { title: 'New AI model ships', source: 'A' },
    { title: 'New laptop architecture', source: 'A' },
    { title: 'City transit changes', source: 'B' },
  ];
  assert.deepEqual(
    selectDiverseItems(items, { limit: 4, maxPerSource: 1, excludePatterns: ['prime day'] })
      .map((item) => item.title),
    ['New AI model ships', 'City transit changes'],
  );
});

test('diversifySections deduplicates stories across sections', () => {
  const result = diversifySections([
    { name: 'Tech', items: [{ title: 'OpenAI launches a faster coding model', source: 'A' }] },
    { name: 'AI', items: [{ title: 'OpenAI launches faster coding model', source: 'B' }] },
  ]);
  assert.equal(result[0].items.length, 1);
  assert.equal(result[1].items.length, 0);
});

