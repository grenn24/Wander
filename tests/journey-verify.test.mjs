import test from 'node:test';
import assert from 'node:assert/strict';
import { nameMatch, km } from '../scripts/journeys/verify.mjs';

test('the same place under the name Google uses still matches', () => {
  assert.ok(nameMatch('Kasuga Taisha', 'Kasugataisha Shrine') >= 0.5);
  assert.ok(nameMatch('Kapellbrucke Lucerne', 'Kapellbrücke') >= 0.5);
  assert.ok(nameMatch('Al Khazneh Treasury Petra', 'The Treasury') >= 0.5);
  assert.ok(nameMatch('Sacsayhuamán', 'Saqsaywaman') >= 0.45);
  assert.equal(nameMatch('Otaru Canal', 'Otaru Canal'), 1);
});

test('a different place does not', () => {
  assert.ok(nameMatch('Peyto Lake', 'Icefields Parkway') < 0.5);
  assert.ok(nameMatch('Lake Agnes Tea House', 'Lake Louise AB') < 0.5);
  assert.ok(nameMatch('Gornergrat Railway', 'Zermatt Station') < 0.5);
  assert.equal(nameMatch('', 'Anything'), 0);
});

test('distance is in kilometres', () => {
  const d = km({ lat: 35.0116, lng: 135.7681 }, { lat: 34.6851, lng: 135.8048 });
  assert.ok(d > 35 && d < 38);
});
