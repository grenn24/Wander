import test from 'node:test';
import assert from 'node:assert/strict';
import { cityCovers } from '../lib/cityCovers.js';
const ids = (text) => cityCovers(text).map(city => city.id);
test('recognises only the five supported destinations', () => {
  assert.deepEqual(ids('Tokyo, Japan'), ['tokyo']);
  assert.deepEqual(ids('Shenzhen / Kuala Lumpur / Nagoya / New York City'), ['shenzhen', 'kuala-lumpur', 'nagoya', 'new-york']);
  for (const text of ['', null, 'Paris', 'Japan', 'York', 'Brooklyn', 'Tokyoite', 'KLCC', 'New Yorkshire']) assert.deepEqual(ids(text), []);
});
test('multi-city covers follow destination order, skip unsupported cities and deduplicate', () => {
  assert.deepEqual(ids('Nagoya → Kyoto → Tokyo → Nagoya'), ['nagoya', 'tokyo']);
  assert.deepEqual(ids('NYC, then KL and Tokyo'), ['new-york', 'kuala-lumpur', 'tokyo']);
});
test('handles supported Chinese/Japanese names and case', () => {
  assert.deepEqual(ids('深圳、吉隆坡、東京、名古屋、紐約'), ['shenzhen', 'kuala-lumpur', 'tokyo', 'nagoya', 'new-york']);
  assert.deepEqual(ids('ＴＯＫＹＯ and NEW YORK'), ['tokyo', 'new-york']);
});
