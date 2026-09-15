import test from 'node:test';
import assert from 'node:assert/strict';
import { queryVariants, keyWords, describes, aboutPlace, unsplashKeys } from '../scripts/journeys/unsplash.mjs';

test('the main Unsplash key comes first, and a backup is only a spare', () => {
  assert.deepEqual(unsplashKeys({ UNSPLASH_ACCESS_KEY: 'main', UNSPLASH_ACCESS_KEY_BACKUP: 'spare' }), ['main', 'spare']);
  assert.deepEqual(unsplashKeys({ UNSPLASH_ACCESS_KEY: 'main', UNSPLASH_ACCESS_KEY_BACKUP: 'REPLACE_WITH_BACKUP_UNSPLASH_ACCESS_KEY' }), ['main']);
  assert.deepEqual(unsplashKeys({ UNSPLASH_ACCESS_KEY: '', UNSPLASH_ACCESS_KEY_BACKUP: ' spare ' }), ['spare']);
  assert.deepEqual(unsplashKeys({}), []);
});

test('a photograph whose caption is generic is looked up before it is turned away', async () => {
  const words = keyWords('Jemaa el-Fnaa');
  const square = { id: 'sq', alt_description: 'a large crowd of people in a city square' };
  const logo = { id: 'logo', alt_description: 'a tuning fork logo and text' };
  const full = {
    sq: { ...square, location: { name: 'Marrakech, Morocco' }, tags: [{ title: 'jemaa el-fnaa' }] },
    logo: { ...logo, tags: [{ title: 'music' }] },
  };
  const looked = [];
  const lookup = async (id) => { looked.push(id); return full[id]; };
  const ready = () => true;
  const found = await aboutPlace([logo, square], words, { lookup, ready, budget: { left: 4 } });
  assert.deepEqual(found.map((p) => p.id), ['sq']);
  assert.deepEqual(looked, ['logo', 'sq']);

  const budget = { left: 1 };
  assert.deepEqual(await aboutPlace([logo, square], words, { lookup, ready, budget }), []);
  assert.equal(budget.left, 0);

  const named = { id: 'n', alt_description: 'Jemaa el-Fnaa at night' };
  looked.length = 0;
  assert.deepEqual((await aboutPlace([square, named], words, { lookup, ready })).map((p) => p.id), ['n']);
  assert.deepEqual(looked, []);
});

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
