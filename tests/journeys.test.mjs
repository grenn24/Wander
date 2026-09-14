import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNEYS, REGIONS, journeyBySlug, journeySummary, filterJourneys, monthFit,
  suggestedMonth, yearFor, composeBrief, BRIEF_LIMIT, momentCount, placeLine,
} from '../lib/journeys.js';

const summaries = JOURNEYS.map(journeySummary);

test('every journey is complete and internally consistent', () => {
  const slugs = new Set();
  for (const j of JOURNEYS) {
    assert.match(j.slug, /^[a-z0-9-]+$/, j.slug);
    assert.ok(!slugs.has(j.slug), `duplicate ${j.slug}`);
    slugs.add(j.slug);
    assert.ok(REGIONS.some((r) => r.id === j.region), `${j.slug} region`);
    assert.ok(Math.abs(j.center.lat) <= 90 && Math.abs(j.center.lng) <= 180, `${j.slug} centre`);
    assert.ok(j.days[0] >= 1 && j.days[0] <= j.days[1], `${j.slug} days`);
    const all = [...j.months.best, ...j.months.good, ...(j.months.avoid || [])];
    assert.ok(all.every((m) => Number.isInteger(m) && m >= 1 && m <= 12), `${j.slug} months`);
    assert.equal(new Set(all).size, all.length, `${j.slug} a month is in two lists`);
    assert.ok(j.months.best.length > 0, `${j.slug} has no best month`);
    assert.ok(j.chapters.length >= 3, `${j.slug} chapters`);
    const ids = j.chapters.flatMap((c) => c.moments.map((m) => m.id));
    assert.equal(new Set(ids).size, ids.length, `${j.slug} moment ids`);
    for (const c of j.chapters) {
      assert.ok(c.title && c.span && c.where && c.body, `${j.slug} chapter fields`);
      assert.ok(Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180, `${j.slug} ${c.title} coords`);
      assert.ok(c.moments.length >= 1);
      for (const m of c.moments) assert.ok(m.name && m.note, `${j.slug} moment fields`);
    }
    assert.ok(j.know.length >= 2 && j.know.every((k) => k.label && k.text), `${j.slug} know`);
    assert.equal(journeyBySlug(j.slug), j);
  }
  assert.equal(journeyBySlug('nowhere'), null);
  // Coverage the catalogue promises: every region has at least one.
  for (const r of REGIONS) assert.ok(JOURNEYS.some((j) => j.region === r.id), r.id);
});

test('filters by region, month and words, including places inside chapters', () => {
  assert.ok(filterJourneys(summaries, { region: 'europe' }).every((j) => j.region === 'europe'));
  assert.deepEqual(filterJourneys(summaries, { q: 'petra' }).map((j) => j.slug), ['jordan-petra-rum']);
  assert.deepEqual(filterJourneys(summaries, { q: 'MACHU' }).map((j) => j.slug), ['peru-sacred-valley']);
  // Accents fold both ways.
  assert.ok(filterJourneys(summaries, { q: 'hue' }).some((j) => j.slug === 'vietnam-by-train'));
  assert.ok(filterJourneys(summaries, { q: 'todai-ji' }).some((j) => j.slug === 'kyoto-blossom'));
  assert.deepEqual(filterJourneys(summaries, { q: 'kyoto zzz' }), []);

  const january = filterJourneys(summaries, { month: 1 });
  assert.ok(january.every((j) => ['best', 'good'].includes(monthFit(j, 1))));
  assert.ok(january.some((j) => j.slug === 'nz-south-island'));
  assert.ok(!january.some((j) => j.slug === 'iceland-ring-road'));
  const firstGood = january.findIndex((j) => monthFit(j, 1) === 'good');
  if (firstGood >= 0) assert.ok(january.slice(firstGood).every((j) => monthFit(j, 1) === 'good'));
});

test('suggests the next best month and the right year', () => {
  const kyoto = journeyBySlug('kyoto-blossom');
  assert.equal(suggestedMonth(kyoto, new Date(2026, 8, 14)), 11);
  assert.equal(suggestedMonth(kyoto, new Date(2026, 10, 20)), 3);
  assert.equal(yearFor(4, new Date(2026, 8, 14)), 2027);
  assert.equal(yearFor(11, new Date(2026, 8, 14)), 2026);
  assert.equal(yearFor(9, new Date(2026, 8, 14)), 2026);
});

test('the brief says when, who and how fast, keeps and drops moments', () => {
  const j = journeyBySlug('kyoto-blossom');
  const withDates = composeBrief(j, {
    mode: 'dates', start: '2027-03-29', days: 6, who: 'couple', pace: 'slower',
    dropped: ['3.2'], extra: 'vegetarian',
  });
  assert.match(withDates, /Dates: 2027-03-29 to 2027-04-03 \(6 days\)/);
  assert.match(withDates, /Who: a couple\./);
  assert.match(withDates, /Pace: slower/);
  assert.match(withDates, /- Kiyomizu-dera, Higashiyama: Go at opening/);
  assert.match(withDates, /Leave out: Fushimi Inari Taisha\./);
  assert.ok(!/- Fushimi Inari Taisha/.test(withDates));
  assert.match(withDates, /Also: vegetarian/);

  const byMonth = composeBrief(j, { mode: 'month', month: 4, days: 99 }, new Date(2026, 8, 14));
  assert.match(byMonth, /When: April 2027, for 30 days/);
  assert.match(byMonth, /Pace: as the journey is written/);
  assert.ok(!/Who:/.test(byMonth));
  assert.ok(!/Leave out/.test(byMonth));

  for (const x of JOURNEYS) {
    const b = composeBrief(x, { mode: 'month', days: x.days[1], extra: 'x'.repeat(2000) });
    assert.ok(b.length <= BRIEF_LIMIT, `${x.slug} brief too long`);
    assert.ok(momentCount(x) > 0);
  }
  assert.equal(placeLine(journeyBySlug('iceland-ring-road')), 'Iceland');
});
