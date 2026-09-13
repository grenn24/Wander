import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { browserThemeScript } from '../lib/browserTheme.js';

function browser({ saved = null, dark = false, blocked = false } = {}) {
  let preference = null, onTheme;
  const events = {};
  const meta = () => ({ content: '', setAttribute(name, value) { this[name] = value; } });
  const colours = [meta(), meta()], scheme = meta();
  const media = { matches: dark, addEventListener(name, fn) { events.media = fn; } };
  const root = {
    getAttribute() { return preference; },
    setAttribute(name, value) { preference = value; onTheme?.(); },
    removeAttribute() { preference = null; onTheme?.(); },
  };
  vm.runInNewContext(browserThemeScript, {
    document: { documentElement: root, head: {}, querySelectorAll: (selector) => selector.includes('theme-color') ? colours : [scheme] },
    localStorage: { getItem() { if (blocked) throw Error('blocked'); return saved; } },
    window: { matchMedia: () => media, addEventListener(name, fn) { events[name] = fn; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target) { if (target === root) onTheme = this.fn; else events.metadata = this.fn; } },
  });
  return { colours, scheme, root, media, events };
}

test('saved app theme overrides the opposite system theme at startup', () => {
  for (const [saved, dark, colour] of [['dark', false, '#201d18'], ['light', true, '#f7f4ee']]) {
    const page = browser({ saved, dark });
    assert.deepEqual(page.colours.map(m => m.content), [colour, colour]);
    assert.equal(page.scheme.content, saved);
  }
});
test('manual changes and returning to System keep browser metadata in sync', () => {
  const page = browser();
  page.root.setAttribute('data-theme', 'dark');
  assert.equal(page.colours[0].content, '#201d18');
  page.events.media();
  assert.equal(page.scheme.content, 'dark');
  page.root.removeAttribute('data-theme');
  assert.equal(page.scheme.content, 'light');
  page.media.matches = true;
  page.events.media();
  assert.equal(page.scheme.content, 'dark');
  page.colours[0].content = 'stale';
  page.events.pageshow();
  assert.equal(page.colours[0].content, '#201d18');
  page.colours[1].content = '#f7f4ee';
  page.events.metadata();
  assert.equal(page.colours[1].content, '#201d18');
});
test('unavailable storage or an invalid saved theme uses the system preference', () => {
  for (const opts of [{ blocked: true }, { saved: 'invalid' }, { saved: 'system' }]) {
    const page = browser({ ...opts, dark: true });
    assert.equal(page.scheme.content, 'dark');
    page.root.setAttribute('data-theme', 'light');
    assert.equal(page.colours[0].content, '#f7f4ee');
  }
});
