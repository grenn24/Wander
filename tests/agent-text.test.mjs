import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAgentText } from '../lib/agentText.js';

const id = '0be27255-7a8f-4f1d-ad69-79f9fb2ee759';
const placeId = 'ChIJ1234567890_abcdef';

test('removes the activity ID from the reported question without losing its name', () => {
  assert.equal(publicAgentText(`Update address for 斯逸國際美食水滙 (id ${id})?`),
    'Update address for 斯逸國際美食水滙?');
});
test('replaces known opaque identifiers with a readable place name', () => {
  assert.equal(publicAgentText('Did you mean opaque-id?', [{ place_id: 'opaque-id', title: 'Harbour branch' }]),
    'Did you mean Harbour branch?');
});
test('filters bare, labelled and resource-style place references', () => {
  for (const input of [placeId, `Google Maps place ID: "opaque-123"`,
    `place_id=opaque-123`, `places/${placeId}`, '0x123abc:0xdeadbeef', id]) {
    const result = publicAgentText(`Did you mean ${input}?`);
    assert.ok(!result.includes(input));
    assert.ok(!result.includes('opaque-123'));
    assert.ok(result.endsWith('?'));
  }
});
test('keeps human-readable names, dates and addresses intact', () => {
  const input = '斯逸國際美食水滙 — 27 Nov, 2pm, 88 Xinghua Road?';
  assert.equal(publicAgentText(input), input);
  assert.equal(publicAgentText(null), '');
});
