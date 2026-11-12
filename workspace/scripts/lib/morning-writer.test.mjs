import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBriefing, writeBriefing, wordLimit } from './morning-writer.mjs';
import { fallbackText } from './morning-speech.mjs';

const facts = [
  { id: 'intro', required: true, text: 'Good morning. Today is Wednesday 21 October.' },
  { id: 'weather', required: true, text: 'Riverside: few clouds, 7 degrees. Today between 7 and 17 degrees. Rain is unlikely.' },
  { id: 'study1', required: true, text: 'Study, due today at 18:00: Programming Lab: form team.', title: 'Programming Lab: form team' },
  { id: 'work1', required: true, text: 'Work, overdue since yesterday, Tuesday 20 October: Check browser compatibility.', title: 'Check browser compatibility' },
  { id: 'study-next', required: false, text: 'Next Study deadline: Thursday 22 October at 16:00, Algorithms: submit sheet 1.', title: 'Algorithms: submit sheet 1' },
  { id: 'problems', required: true, text: "I couldn't check Google Calendar, so this briefing may be incomplete.", title: 'Google Calendar' },
];
const good = { paragraphs: [
  { facts: ['intro', 'weather'], text: "Good morning, it's Wednesday 21 October. Few clouds and 7 degrees in Riverside, up to 17 today, and no rain." },
  { facts: ['work1', 'study1'], text: 'At work, the browser compatibility check has been overdue since yesterday. For study, form your Programming Lab team by 18:00 today.' },
  { facts: ['problems'], text: "I couldn't reach Google Calendar this morning, so some appointments may be missing." },
] };
const variant = (index, change) => ({ paragraphs: good.paragraphs.map((p, i) => i === index ? { ...p, ...change } : p) });

test('a faithful rewrite is accepted', () => {
  assert.equal(validateBriefing(facts, good, 450).length, 3);
});

test('invented numbers, date words, unknown facts, dropped tasks, missing facts and misplaced problems are rejected', () => {
  const cases = [
    [variant(1, { text: 'At work, the browser compatibility check is overdue. For study, form your Programming Lab team by 6 today.' }), /number 6/],
    [variant(1, { text: 'At work, the browser compatibility check is due today.', facts: ['work1'] }), /"today"/],
    [variant(1, { text: 'At work, the browser compatibility check is overdue since Monday. For study, form your Programming Lab team by 18:00 today.' }), /"monday"/],
    [variant(0, { facts: ['intro', 'weather', 'study9'] }), /unknown fact/],
    [variant(1, { text: 'At work, check browser compatibility. For study, form your Programming Lab team by 18:00 today.' }), /work1 is overdue/],
    [variant(1, { text: 'At work, the browser compatibility check has been overdue since yesterday. For study, form your Programming Lab team by 18:00.' }), /study1 is due today/],
    [variant(1, { text: 'At work, one item has been overdue since yesterday. For study, form your Programming Lab team by 18:00 today.' }), /work1 is cited but not mentioned/],
    [{ paragraphs: good.paragraphs.slice(0, 2) }, /missing: problems/],
    [{ paragraphs: [good.paragraphs[2], ...good.paragraphs.slice(0, 2)] }, /last paragraph/],
    [variant(0, { text: "Good morning, it's Wednesday 21 October. ☀️ Few clouds, 7 degrees, up to 17 today." }), /emoji/],
  ];
  for (const [response, reason] of cases) assert.throws(() => validateBriefing(facts, response, 450), reason);
  assert.throws(() => validateBriefing(facts, good, 20), /limit is 20/);
});

test('quotation marks are removed before Alexa reads the text', () => {
  const quoted = variant(1, { text: 'At work, the “browser compatibility” check has been overdue since yesterday. For study, form your Programming Lab team by 18:00 today.' });
  assert.equal(validateBriefing(facts, quoted, 450)[1], 'At work, the browser compatibility check has been overdue since yesterday. For study, form your Programming Lab team by 18:00 today.');
});

test('times may drop their leading zero', () => {
  const morning = [{ id: 'event1', required: true, text: 'Today from 09:00 to 10:00: Dentist.', title: 'Dentist' }];
  assert.doesNotThrow(() => validateBriefing(morning, { paragraphs: [{ facts: ['event1'], text: 'The dentist is at 9:00 today.' }] }, 450));
});

test('a rejected answer is retried with the reason, then accepted', async () => {
  const seen = [];
  const result = await writeBriefing(facts, { request: async (_, maxWords, rejection) => {
    seen.push(rejection);
    assert.equal(maxWords, wordLimit(facts));
    return seen.length === 1 ? { paragraphs: good.paragraphs.slice(0, 2) } : good;
  } });
  assert.equal(seen[0], null);
  assert.match(seen[1], /missing: problems/);
  assert.equal(result.status.ready, true);
  assert.equal(result.status.attempts, 2);
});

test('two failures fall back to reading the required facts as written', async () => {
  let calls = 0;
  const result = await writeBriefing(facts, { request: async () => { calls++; throw new Error('Spoken English AI returned HTTP 502'); } });
  assert.equal(calls, 2);
  assert.deepEqual(result.paragraphs, [fallbackText(facts)]);
  assert.ok(!result.paragraphs[0].includes('Algorithms'));
  assert.equal(result.status.fallback, true);
  assert.match(result.status.error, /502/);
});
