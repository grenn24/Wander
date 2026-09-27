import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDES, REGIONS, guideBySlug, filterGuides, monthFit, suggestedMonth, yearFor,
  composeBrief, BRIEF_LIMIT, placeLine,
} from '../lib/guides.js';
import {
  fromV1, validateDoc, normaliseDoc, tokenize, plainText, summaryOf, cleanText,
  imageURL, srcSet, modelFields, WRITER_SCHEMA, videoSpot,
} from '../lib/guideFormat.js';

const docs = GUIDES.map(fromV1);
const doc = (slug) => docs.find((d) => d.slug === slug);
const summaries = docs.map(summaryOf);

test('the hand-written guides are complete and consistent', () => {
  const slugs = new Set();
  for (const j of GUIDES) {
    assert.match(j.slug, /^[a-z0-9-]+$/, j.slug);
    assert.ok(!slugs.has(j.slug), `duplicate ${j.slug}`);
    slugs.add(j.slug);
    const all = [...j.months.best, ...j.months.good, ...(j.months.avoid || [])];
    assert.equal(new Set(all).size, all.length, `${j.slug} a month is in two lists`);
    assert.ok(j.chapters.length >= 3 && j.know.length >= 2, j.slug);
    assert.equal(guideBySlug(j.slug), j);
  }
  for (const r of REGIONS) assert.ok(GUIDES.some((j) => j.region === r.id), r.id);
});

test('each converts to a valid block journal with every place tappable', () => {
  for (const d of docs) {
    const v = validateDoc(d, { strict: false });
    assert.ok(v.ok, `${d.slug}: ${v.errors.join('; ')}`);
    const mentioned = new Set(d.blocks.flatMap((b) => tokenize(b.text).filter((p) => p.place).map((p) => p.place)));
    for (const p of d.places) assert.ok(mentioned.has(p.id), `${d.slug}: ${p.name} is not in the text`);
    for (const b of d.blocks) assert.ok(!/\{p\d+\}/.test(plainText(b.text, d.places)), d.slug);
  }
  assert.match(doc('kyoto-blossom').blocks[1].text, /Climb to \{p1\} as it opens/);
  // Sannenzaka is never named in its chapter, so it is gathered at the end.
  assert.match(doc('kyoto-blossom').blocks[1].text, /Worth the stop: \{p2\}\.$/);
  // "Fushimi Inari" is enough to find Fushimi Inari Taisha; one word is not.
  const markets = doc('kyoto-blossom').blocks.find((b) => b.type === 'prose' && /Nishiki/.test(plainText(b.text, doc('kyoto-blossom').places)));
  assert.match(markets.text, /gates of \{p8\} as far/);
  const nara = doc('kyoto-blossom').blocks.find((b) => b.type === 'prose' && /deer in the park/.test(b.text));
  assert.match(nara.text, /^Nara is under an hour/);
});

test('strict validation holds written guides to the house rules', () => {
  const ladder = validateDoc(doc('kyoto-blossom'));
  assert.ok(!ladder.ok);
  assert.ok(ladder.errors.some((e) => /two kinds of block/.test(e)));

  const base = doc('kyoto-blossom');
  const raw = { ...base, blocks: [...base.blocks, { type: 'prose', text: 'See {p99}.', layout: 'none', items: [] }] };
  assert.ok(validateDoc(raw, { strict: false }).errors.some((e) => /p99/.test(e)));
  assert.ok(!normaliseDoc(raw).blocks.some((b) => /p99/.test(b.text || '')));

  const unmentioned = { ...base, places: [...base.places, { id: 'p50', name: 'Nowhere', q: 'Nowhere', note: 'x' }] };
  assert.ok(validateDoc(unmentioned).errors.some((e) => /never mentioned/.test(e)));
  assert.ok(validateDoc(unmentioned, { strict: false }).warnings.some((e) => /never mentioned/.test(e)));

  // Readers need to know where they are: a guide without sections is sent back.
  const unsectioned = validateDoc({ ...base, blocks: base.blocks.filter((b) => b.type !== 'heading') });
  assert.ok(unsectioned.errors.some((e) => /first section needs a heading/.test(e)));
  assert.ok(unsectioned.errors.some((e) => /divide the guide into sections/.test(e)));
  assert.ok(!validateDoc(base).errors.some((e) => /section/.test(e)));
});

test('video blocks keep a real YouTube video and a guide has at most four', () => {
  const base = doc('kyoto-blossom');
  const clip = { provider: 'youtube', id: 'abcdefghijk', title: 'Philosopher’s Path walk' };
  const withClips = normaliseDoc({
    ...base,
    blocks: [
      ...base.blocks,
      { type: 'video', query: 'Philosophers Path walk', caption: 'The path in April', video: clip },
      { type: 'video', query: 'Nishiki Market', video: { provider: 'youtube', id: 'bad' } },
      { type: 'prose', text: 'x', video: clip },
    ],
  });
  const clips = withClips.blocks.filter((b) => b.type === 'video');
  assert.deepEqual(clips.map((b) => b.video && b.video.id), ['abcdefghijk', null]);
  assert.equal(withClips.blocks[withClips.blocks.length - 1].video, undefined);
  assert.ok(!validateDoc(withClips, { strict: false }).errors.some((e) => /video/.test(e)));

  const tooMany = { ...base, blocks: [...base.blocks, ...Array.from({ length: 5 }, () => ({ type: 'video', query: 'q', items: [] }))] };
  assert.ok(validateDoc(tooMany).errors.some((e) => /four video blocks/.test(e)));
  assert.ok(validateDoc({ ...base, blocks: [...base.blocks, { type: 'video', query: '', items: [] }] }, { strict: false })
    .errors.some((e) => /\(video\) has no query/.test(e)));
});

test('the video sits at the end of the first section, not below the journal', () => {
  const t = (type, extra = {}) => ({ type, ...extra });
  assert.equal(videoSpot([t('heading'), t('prose'), t('photo'), t('heading'), t('prose')]), 3);
  assert.equal(videoSpot([t('prose', { kicker: 'Days 1–3 · A' }), t('photo'), t('prose', { kicker: 'Day 4 · B' })]), 2);
  assert.equal(videoSpot([t('prose'), t('photo'), t('prose')]), 1);
  assert.equal(videoSpot([t('photo')]), 1);
  assert.equal(videoSpot(undefined), 0);
});

test('links and citations never reach the page', () => {
  assert.equal(cleanText('Road closed ([parks.canada.ca](https://parks.canada.ca/x)) to cars.'), 'Road closed to cars.');
  assert.equal(cleanText('See [Parks Canada](https://parks.canada.ca) now'), 'See Parks Canada now');
  assert.equal(cleanText('Open daily https://example.com/x.'), 'Open daily');
  assert.equal(cleanText(null), null);
});

test('text splits into words and places', () => {
  assert.deepEqual(tokenize('Walk to {p1}, then {p2}.'), [
    { text: 'Walk to ' }, { place: 'p1' }, { text: ', then ' }, { place: 'p2' }, { text: '.' },
  ]);
  assert.deepEqual(tokenize(''), []);
  assert.equal(plainText('Walk to {p1}.', [{ id: 'p1', name: 'Ginkaku-ji' }]), 'Walk to Ginkaku-ji.');
});

test('filters by region, month and words, including place names', () => {
  assert.ok(filterGuides(summaries, { region: 'europe' }).every((j) => j.region === 'europe'));
  assert.deepEqual(filterGuides(summaries, { q: 'petra' }).map((j) => j.slug), ['jordan-petra-rum']);
  assert.deepEqual(filterGuides(summaries, { q: 'MACHU' }).map((j) => j.slug), ['peru-sacred-valley']);
  assert.ok(filterGuides(summaries, { q: 'hue' }).some((j) => j.slug === 'vietnam-by-train'));
  assert.ok(filterGuides(summaries, { q: 'todai-ji' }).some((j) => j.slug === 'kyoto-blossom'));
  assert.deepEqual(filterGuides(summaries, { q: 'kyoto zzz' }), []);
  const january = filterGuides(summaries, { month: 1 });
  assert.ok(january.every((j) => ['best', 'good'].includes(monthFit(j, 1))));
  assert.ok(january.some((j) => j.slug === 'nz-south-island'));
  assert.ok(!january.some((j) => j.slug === 'iceland-ring-road'));
});

test('suggests the next best month and the right year', () => {
  assert.equal(suggestedMonth(doc('kyoto-blossom'), new Date(2026, 8, 14)), 11);
  assert.equal(suggestedMonth(doc('kyoto-blossom'), new Date(2026, 10, 20)), 3);
  assert.equal(yearFor(4, new Date(2026, 8, 14)), 2027);
  assert.equal(yearFor(9, new Date(2026, 8, 14)), 2026);
});

test('the brief says when, who and how fast, and keeps and drops places', () => {
  const kyoto = doc('kyoto-blossom');
  const fushimi = kyoto.places.find((p) => p.name === 'Fushimi Inari Taisha').id;
  const b = composeBrief(kyoto, {
    mode: 'dates', start: '2027-03-29', days: 6, who: 'couple', pace: 'slower', dropped: [fushimi], extra: 'vegetarian',
  });
  assert.match(b, /Dates: 2027-03-29 to 2027-04-03 \(6 days\)/);
  assert.match(b, /Who: a couple\./);
  assert.match(b, /- Kiyomizu-dera: Go at opening/);
  assert.match(b, /Leave out: Fushimi Inari Taisha\./);
  assert.ok(!/- Fushimi Inari Taisha:/.test(b));
  assert.match(b, /1\. 2 days · Higashiyama — The east side, on foot/);
  assert.match(b, /Also: vegetarian/);

  const byMonth = composeBrief(kyoto, { mode: 'month', month: 4, days: 99 }, new Date(2026, 8, 14));
  assert.match(byMonth, /When: April 2027, for 30 days/);
  assert.ok(!/Leave out/.test(byMonth));
  for (const d of docs) {
    assert.ok(composeBrief(d, { mode: 'month', days: 7, extra: 'x'.repeat(3000) }).length <= BRIEF_LIMIT);
  }
  assert.equal(placeLine(doc('iceland-ring-road')), 'Iceland');
});

test('Unsplash links resize without exceeding the original', () => {
  const m = { raw: 'https://images.unsplash.com/photo-1?ixid=abc', width: 3000 };
  assert.equal(imageURL(m, 1200), 'https://images.unsplash.com/photo-1?ixid=abc&w=1200&q=80&auto=format&fit=max');
  assert.match(imageURL(m, 5000), /w=3000/);
  assert.equal(srcSet(m, [1000, 2000, 4000]).split(', ').length, 2);
  assert.equal(imageURL(null, 100), '');
});

test('the writer schema is strict all the way down, and round-trips', () => {
  const walk = (node, path) => {
    if (!node) return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), path);
      Object.entries(node.properties).forEach(([k, v]) => walk(v, `${path}.${k}`));
    }
    if (node.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(WRITER_SCHEMA, 'guide');
  const back = modelFields(doc('kyoto-blossom'));
  assert.deepEqual(Object.keys(back).sort(), [...WRITER_SCHEMA.required].sort());
  assert.deepEqual(Object.keys(back.blocks[0]).sort(),
    [...WRITER_SCHEMA.properties.blocks.items.required].sort());
});
