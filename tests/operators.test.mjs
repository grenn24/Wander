import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { operatorOf, isJR } from '../lib/operators.js';
import LOGOS from '../lib/operatorLogos.js';

const publicFile = (path) => new URL(`../public${path}`, import.meta.url);

test('an operator is found by its Japanese name or its line\'s English one', () => {
  const metro = operatorOf({ operator: '東京地下鉄' });
  assert.equal(metro.name, 'Tokyo Metro');
  assert.equal(metro.mark, 'TM');
  assert.equal(operatorOf({ line: 'Toei Oedo Line' }).name, 'Toei');
  assert.equal(operatorOf({ line: 'JR Chuo Rapid Line' }).name, 'JR East');
  assert.ok(isJR(operatorOf({ operator: 'JR九州' })));
  assert.ok(!isJR(metro));
});

test('an operator known only by name gets its initials and no logo', () => {
  const op = operatorOf({ operator: 'Example Railway' });
  assert.deepEqual(op, { name: 'Example Railway', mark: 'ER', colour: '#5A5148', logo: null });
  assert.equal(operatorOf({ line: 'Unknown Line' }), null);
});

test('an operator with a logo on file shows it, and a shared line its first company\'s', () => {
  for (const { file } of Object.values(LOGOS)) assert.match(file, /^\/operators\/[a-z0-9-]+\.svg$/);
  if (LOGOS['JR Central']) {
    assert.equal(operatorOf({ operator: 'JR東海・JR西日本' }).logo, LOGOS['JR Central'].file);
  }
  if (LOGOS['JR East']) assert.equal(operatorOf({ operator: 'JR東日本' }).logo, LOGOS['JR East'].file);
});

test('every logo on file is a free licence, and a plain SVG that is there', () => {
  for (const { file, licence, source } of Object.values(LOGOS)) {
    assert.match(licence, /^(Public domain|CC0)/i);
    assert.match(source, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    const svg = readFileSync(publicFile(file), 'utf8');
    assert.ok(svg.includes('<svg'));
    assert.doesNotMatch(svg, /<script|\son[a-z]+\s*=|javascript:|<foreignObject/i);
  }
  const listed = new Set(Object.values(LOGOS).map((l) => l.file.replace('/operators/', '')));
  const onDisk = readdirSync(publicFile('/operators/')).filter((f) => f.endsWith('.svg'));
  assert.deepEqual(onDisk.filter((f) => !listed.has(f)), [], 'no logo without its credit');
});
