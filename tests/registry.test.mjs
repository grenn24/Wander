import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { operatorOf, operatorEntry, lineOf, linePrefixOf, transferOff, countryOf, plain } from '../lib/registry.js';
import JP from '../data/transit/registry/jp.json' with { type: 'json' };
import LOGOS from '../data/transit/registry/logos.json' with { type: 'json' };

const read = (name) => JSON.parse(readFileSync(new URL(`../data/transit/${name}`, import.meta.url), 'utf8'));

test('a country file is well formed: unique ids, every line\'s operator known', () => {
  for (const country of [JP]) {
    assert.match(country.country, /^[A-Z]{2}$/);
    assert.ok(country.currency && country.timeZone);
    const ids = new Set();
    for (const op of country.operators) {
      assert.match(op.id, /^[a-z0-9-]+$/, op.id);
      assert.ok(!ids.has(op.id), `${op.id} twice`);
      ids.add(op.id);
      assert.ok(op.name, `${op.id} has an English name`);
      if (op.colour) assert.match(op.colour, /^#[0-9A-F]{6}$/i);
      if (op.wikidata) assert.match(op.wikidata, /^Q\d+$/);
      (op.parts || []).forEach((p) => assert.ok(country.operators.some((o) => o.id === p), `${op.id}: part ${p}`));
      if (op.fares && op.fares.card) {
        const limits = op.fares.card.bands.map(([km]) => km);
        limits.slice(1).forEach((km, i) => assert.ok(km == null || km > limits[i], `${op.id}: bands in order`));
      }
    }
    for (const line of country.lines) {
      assert.ok(ids.has(line.operator), `${line.name}: no operator ${line.operator}`);
      if (line.colour) assert.match(line.colour, /^#[0-9A-F]{6}$/i);
    }
    for (const t of country.transfers) t.between.forEach((id) => assert.ok(ids.has(id), `transfer: ${id}`));
  }
});

test('every operator a data file names is in the registry', () => {
  const names = new Set([
    ...read('japan-rail.json').operators,
    ...read('open-rail.json').lines.map((l) => l[3]),
    ...read('tokyo-rail.json').lines.map((l) => l[3]),
  ]);
  const missing = [...names].filter((n) => n && !operatorOf(n).key);
  assert.deepEqual(missing, []);
});

test('an operator by any of its names', () => {
  const metro = operatorOf('東京地下鉄');
  assert.equal(metro.key, 'JP/tokyo-metro');
  assert.equal(metro.name, 'Tokyo Metro');
  assert.equal(metro.mark, 'TM');
  assert.equal(operatorOf('TokyoMetro').key, metro.key, 'as mini-tokyo-3d names it');
  assert.equal(operatorOf('tokyo metro').key, metro.key, 'in any case');
  assert.equal(operatorOf('Kōnan Railway').key, operatorOf('弘南鉄道').key, 'as an open feed names it');
  assert.equal(operatorOf('JR九州').group, 'JR');
  assert.equal(operatorOf('JR九州').badge, 'square');
  assert.equal(operatorOf('東京地下鉄').group, null);
  assert.equal(operatorEntry(metro.key).wikidata, 'Q682894');
  assert.equal(linePrefixOf('JR-East'), 'JR');
  assert.equal(linePrefixOf('TokyoMetro'), '');
});

test('an operator it does not know keeps its name and initials; no name, null', () => {
  assert.deepEqual(operatorOf('Example Railway'), {
    key: null, name: 'Example Railway', mark: 'ER', colour: '#5A5148', logo: null, group: null, badge: 'round',
  });
  assert.equal(operatorOf(null), null);
});

test('a line by its operator and any of its names', () => {
  const metro = operatorOf('東京地下鉄');
  assert.equal(lineOf(metro, 'Marunouchi Line').code, 'M');
  assert.equal(lineOf(metro, '丸ノ内線').code, 'M');
  assert.equal(lineOf(metro, 'Nope', '丸ノ内線分岐線').code, 'Mb', 'the first name it knows');
  assert.equal(lineOf(operatorOf('福岡市'), 'Kuko Line').code, 'K', 'without its macrons');
  assert.equal(lineOf(operatorOf('東京都'), 'Marunouchi Line'), null, 'another operator\'s line');
  assert.equal(plain(' Keiō  Line '), 'keio line');
});

test('changing between operators: the registry\'s discount, either way round, on its basis only', () => {
  const metro = operatorOf('東京地下鉄');
  const toei = operatorOf('東京都');
  assert.equal(transferOff(metro, toei, 'card'), 70);
  assert.equal(transferOff(toei, metro, 'card'), 70);
  assert.equal(transferOff(metro, toei, 'ticket'), 0);
  assert.equal(transferOff(metro, operatorOf('JR東日本'), 'card'), 0);
  assert.deepEqual(countryOf('JP'), { country: 'JP', name: 'Japan', currency: 'JPY', timeZone: 'Asia/Tokyo', card: 'IC card' });
});

test('logos: each a file that is there, with its licence and source; a shared line shows its first company\'s', () => {
  for (const [key, { file, licence, source }] of Object.entries(LOGOS)) {
    assert.match(key, /^[A-Z]{2}\/[a-z0-9-]+$/);
    assert.ok(operatorEntry(key), `${key} is an operator`);
    assert.match(file, /^\/operators\/[a-z]{2}\/[a-z0-9-]+\.(svg|png)$/);
    assert.ok(licence, `${key} has a licence`);
    assert.match(source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    const body = readFileSync(new URL(`../public${file}`, import.meta.url));
    if (file.endsWith('.svg')) assert.doesNotMatch(body.toString('utf8'), /<script|\son[a-z]+\s*=|javascript:|<foreignObject/i);
  }
  if (LOGOS['JP/jr-central']) assert.equal(operatorOf('JR東海・JR西日本').logo, LOGOS['JP/jr-central'].file);
  const listed = new Set(Object.values(LOGOS).map((l) => l.file));
  const onDisk = readdirSync(new URL('../public/operators/jp/', import.meta.url)).map((f) => `/operators/jp/${f}`);
  assert.deepEqual(onDisk.filter((f) => !listed.has(f)), [], 'no logo without its credit');
});
