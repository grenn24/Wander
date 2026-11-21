import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/*
 * Every route that pays for a model call answers only someone signed in.
 * parse, suggest, packing, vision and plan used to answer anyone who could
 * reach the address — the planner on the better model included.
 */
function routesCallingOpenAI(dir = 'app/api') {
  const out = [];
  for (const name of readdirSync(new URL(`../${dir}`, import.meta.url))) {
    const path = `${dir}/${name}`;
    if (statSync(new URL(`../${path}`, import.meta.url)).isDirectory()) out.push(...routesCallingOpenAI(path));
    else if (name === 'route.js') {
      const src = read(path);
      if (/askJson\(|api\.openai\.com/.test(src)) out.push(path);
    }
  }
  return out;
}

test('every route that calls a model checks who is asking', () => {
  const routes = routesCallingOpenAI();
  // The ones this was written for, so the search itself cannot quietly find nothing.
  for (const known of ['parse', 'suggest', 'packing', 'vision', 'plan', 'command', 'guides/ask', 'trips/cover']) {
    assert.ok(routes.includes(`app/api/${known}/route.js`), `${known} is found`);
  }
  for (const path of routes) {
    const src = read(path);
    if (path === 'app/api/places/resolve/route.js') {
      // The lookup is open, as Google's search is; only its model ranking needs a sign-in.
      assert.match(src, /reviewAmbiguous && unsure && \(await userFromRequest\(req\)\)/, path);
    } else {
      assert.match(src, /userFromRequest\(req\)|asUser\(req\)/, `${path} identifies the caller`);
    }
  }
});

test('the pages that call those routes send the token', () => {
  const calls = [
    ['components/QuickAdd.jsx', '/api/parse'],
    ['components/AiSuggest.jsx', '/api/suggest'],
    ['components/Packing.jsx', '/api/packing'],
    ['components/Command.jsx', '/api/vision'],
    ['components/Command.jsx', '/api/places/resolve'],
    ['app/plan/page.js', '/api/vision'],
    ['app/plan/page.js', '/api/plan'],
    ['app/plan/page.js', '/api/places/resolve'],
  ];
  for (const [file, route] of calls) {
    const src = read(file);
    let at = src.indexOf(`fetch('${route}'`);
    assert.ok(at >= 0, `${file} calls ${route}`);
    while (at >= 0) {
      const call = src.slice(at, at + 400);
      assert.match(call, /authHeader\(\)|Authorization: `Bearer/, `${file} signs its call to ${route}`);
      at = src.indexOf(`fetch('${route}'`, at + 1);
    }
  }
});
