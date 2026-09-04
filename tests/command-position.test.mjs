import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusCommandField, holdCommandPage } from '../lib/commandFocus.js';

test('opening holds the document still and closing restores the original styles', () => {
  const doc = { body: { style: { overflow: 'auto' } }, documentElement: { style: { scrollbarGutter: '' } } };
  const release = holdCommandPage(doc);
  assert.equal(doc.body.style.overflow, 'hidden');
  assert.equal(doc.documentElement.style.scrollbarGutter, 'stable');
  release();
  assert.equal(doc.body.style.overflow, 'auto');
  assert.equal(doc.documentElement.style.scrollbarGutter, '');
});

test('reply focus cannot scroll the page and reveals an offscreen field inside the panel', () => {
  let options;
  const panel = { scrollTop: 0, getBoundingClientRect: () => ({ top: 80, bottom: 500 }), querySelector: () => null };
  const field = { focus: (opts) => { options = opts; }, closest: () => panel,
    getBoundingClientRect: () => ({ top: 510, bottom: 560 }) };
  focusCommandField(field);
  assert.deepEqual(options, { preventScroll: true });
  assert.equal(panel.scrollTop, 72);
  field.getBoundingClientRect = () => ({ top: 180, bottom: 220 });
  focusCommandField(field);
  assert.equal(panel.scrollTop, 72);
});

test('focus reveals replies hidden behind the sticky composer', () => {
  const header = { contains: () => false, getBoundingClientRect: () => ({ bottom: 160 }) };
  const panel = { scrollTop: 100, getBoundingClientRect: () => ({ top: 80, bottom: 500 }), querySelector: () => header };
  focusCommandField({ focus: () => {}, closest: () => panel, getBoundingClientRect: () => ({ top: 140, bottom: 180 }) });
  assert.equal(panel.scrollTop, 80);
  assert.doesNotThrow(() => focusCommandField(null));
});

test('command layout has stable anchors instead of content, hover or sheet-based movement', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const command = readFileSync(new URL('../components/Command.jsx', import.meta.url), 'utf8');
  const panel = css.match(/\.ck \{([^}]+)\}/)[1];
  assert.match(panel, /scrollbar-gutter: stable/);
  assert.match(panel, /overflow-anchor: none/);
  assert.match(panel, /animation: fadein/);
  assert.match(css, /--ck-top: clamp\(24px, 9svh, 80px\)/);
  assert.doesNotMatch(css, /\.cmd-pill:hover\s*\{[^}]*translate/);
  assert.doesNotMatch(css, /\.shell:has\(\.mapstage\) \.cmd-pill\s*\{[^}]*var\(--sheet-h\)/);
  assert.doesNotMatch(command, /\.current\.focus\(/);
  assert.match(command, /holdCommandPage\(document\)/);
});
