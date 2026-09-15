import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { countryCode } from '../lib/countries.js';
import { cleanSafety, validateDoc, fromV1 } from '../lib/journeyFormat.js';
import { JOURNEYS } from '../lib/journeys.js';

test('country names find their flag, however they are written', () => {
  const cases = {
    Japan: 'JP', 'United States': 'US', USA: 'US', 'Costa Rica': 'CR', Brazil: 'BR', Taiwan: 'TW',
    Australia: 'AU', Fiji: 'FJ', Slovenia: 'SI', Norway: 'NO', Spain: 'ES', Chile: 'CL',
    'United Kingdom': 'GB', UK: 'GB', Türkiye: 'TR', Turkey: 'TR', 'Czech Republic': 'CZ', Myanmar: 'MM',
    'south korea': 'KR',
  };
  for (const [name, code] of Object.entries(cases)) assert.equal(countryCode(name), code, name);
  assert.equal(countryCode('Nowhere'), null);
  assert.equal(countryCode(''), null);
  for (const j of JOURNEYS) {
    const code = countryCode(j.country);
    assert.ok(code, `${j.country} has a flag code`);
    assert.ok(existsSync(new URL(`../public/flags/${code.toLowerCase()}.svg`, import.meta.url)), `${code} has a flag image`);
  }
});

test('a safety note needs advice; its level can be missing but never made up', () => {
  assert.deepEqual(
    cleanSafety({ level: 2, advice: ' Busy areas see petty theft. ', watch: ['Pickpockets', '', 'Heat', 'Sun', 'Tides', 'Extra'] }),
    { level: 2, advice: 'Busy areas see petty theft.', watch: ['Pickpockets', 'Heat', 'Sun', 'Tides'] },
  );
  assert.deepEqual(cleanSafety({ level: null, advice: 'Check park alerts.', watch: [] }), { level: null, advice: 'Check park alerts.', watch: [] });
  assert.equal(cleanSafety({ level: 7, advice: 'x', watch: [] }).level, null);
  assert.equal(cleanSafety({ level: 1, advice: '', watch: ['x'] }), null);
  assert.equal(cleanSafety(null), null);

  const doc = fromV1(JOURNEYS[0]);
  assert.ok(validateDoc(doc).errors.some((e) => /safety/.test(e)));
  assert.ok(!validateDoc({ ...doc, safety: { level: 1, advice: 'Normal precautions.', watch: ['Crowds'] } }).errors.some((e) => /safety/.test(e)));
  assert.ok(!validateDoc(doc, { strict: false }).errors.some((e) => /safety/.test(e)));
});
