import test from 'node:test';
import assert from 'node:assert/strict';
import { queryVariants, keyWords, describes } from '../scripts/journeys/unsplash.mjs';

test('a photograph must name the place the query names', () => {
  assert.deepEqual(keyWords('Muley Point sunset over San Juan River canyons, Utah'), ['muley', 'juan']);
  assert.deepEqual(keyWords('Goblin Valley hoodoos at dawn, Utah'), ['goblin']);
  assert.deepEqual(keyWords('desert road at dusk'), []);
  const words = keyWords('Muley Point sunset over San Juan River canyons, Utah');
  assert.equal(describes({ alt_description: 'Grand Canyon during sunrise' }, words), false);
  assert.equal(describes({ alt_description: 'canyon at sunset', tags: [{ title: 'Muley Point' }] }, words), true);
  assert.equal(describes({ alt_description: 'anything' }, []), true);
  assert.equal(describes({ location: { name: 'Sensō-ji, Tokyo' } }, keyWords('Senso-ji Tokyo')), true);
});

test('a descriptive photo query falls back to the keywords Unsplash can match', () => {
  assert.deepEqual(queryVariants('Goblin Valley hoodoos at dawn and Chesler Park sandstone spires, Utah'), [
    'Goblin Valley hoodoos at dawn and Chesler Park sandstone spires, Utah',
    'Goblin Valley hoodoos Utah',
    'Goblin Valley',
  ]);
  const burr = queryVariants('Burr Trail Switchbacks and Waterpocket Fold in October light, southern Utah');
  assert.equal(burr[1], 'Burr Trail Switchbacks southern Utah');
  assert.equal(burr[burr.length - 1], 'Burr Trail');
});

test('a query that is already short is tried once', () => {
  assert.deepEqual(queryVariants('Otaru Canal'), ['Otaru Canal']);
  assert.deepEqual(queryVariants(''), []);
});
