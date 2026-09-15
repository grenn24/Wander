import test from 'node:test';
import assert from 'node:assert/strict';
import { JOURNEYS } from '../lib/journeys.js';
import { fromV1 } from '../lib/journeyFormat.js';
import { journalContext } from '../lib/journeyAsk.js';

test('a question is answered from the whole journal, with places as tokens', () => {
  const doc = { ...fromV1(JOURNEYS[0]), checked: '2026-09-15' };
  doc.blocks = [
    ...doc.blocks,
    { type: 'tip', label: 'Book ahead', text: 'Reserve {p1}.' },
    { type: 'photo', query: 'SECRET PHOTO QUERY', photos: [] },
    { type: 'video', query: 'x', video: { title: 'A walk' } },
    { type: 'day', title: 'One day', items: [{ time: '7:30', text: 'Walk to {p2}.' }] },
  ];
  const text = journalContext(doc);
  assert.match(text, /^Journey: /);
  assert.match(text, new RegExp(`\\{p1\\} ${doc.places[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(text, /\nSection 1: /);
  assert.match(text, /\[Tip: Book ahead\] Reserve \{p1\}\./);
  assert.match(text, /\[Video: A walk\]/);
  assert.match(text, /\[One day\] 7:30 Walk to \{p2\}\./);
  assert.match(text, /Checked against current information on 2026-09-15\./);
  assert.ok(!text.includes('SECRET PHOTO QUERY'));
  assert.ok(!text.includes('null'));
});
