/*
 * Everything about guides except the guides themselves.
 *
 * The catalogue's prose is only needed by the pages that show it. The rail on
 * the trip list, the cards and the planner form need months, labels and the
 * brief — so those live here, and importing them does not ship every journal
 * to every page that shows a card.
 */

export const REGIONS = [
  { id: 'asia', label: 'Asia' },
  { id: 'europe', label: 'Europe' },
  { id: 'americas', label: 'Americas' },
  { id: 'africa-me', label: 'Africa & Middle East' },
  { id: 'oceania', label: 'Oceania' },
];

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

export const WHO = [
  { id: 'solo', label: 'Solo', brief: 'travelling solo' },
  { id: 'couple', label: 'Couple', brief: 'a couple' },
  { id: 'friends', label: 'Friends', brief: 'a group of friends' },
  { id: 'family', label: 'Family', brief: 'a family with children' },
];

export const PACES = [
  { id: 'slower', label: 'Slower', brief: 'slower than written — fewer stops a day, unhurried afternoons' },
  { id: 'written', label: 'As written', brief: 'as the guide is written' },
  { id: 'fuller', label: 'Fuller', brief: 'fuller than written — fit more into each day' },
];

const COST = ['', 'Easy on the wallet', 'Mid-range', 'Splurge'];

/** The US State Department's four advisory levels, in its own words. */
export const SAFETY_LEVELS = ['', 'Exercise normal precautions', 'Exercise increased caution', 'Reconsider travel', 'Do not travel'];

export function regionLabel(id) {
  const r = REGIONS.find((x) => x.id === id);
  return r ? r.label : '';
}

/** best | good | avoid | fine, for a month numbered 1–12. */
export function monthFit(j, month) {
  if (j.months.best.includes(month)) return 'best';
  if (j.months.good.includes(month)) return 'good';
  if ((j.months.avoid || []).includes(month)) return 'avoid';
  return 'fine';
}

export function daysLabel(j) {
  const [a, b] = j.days;
  return a === b ? `${a} days` : `${a}–${b} days`;
}

export function costLabel(j) {
  return COST[j.cost] || '';
}

/** Where the place is, without saying the country twice. */
export function placeLine(j) {
  return j.place === j.country ? j.country : `${j.place}, ${j.country}`;
}

export function placeCount(doc) {
  return (doc.places || []).length;
}

export function foldText(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const FIT_RANK = { best: 0, good: 1, fine: 2, avoid: 3 };

/**
 * The catalogue, narrowed. A month keeps guides that are best or good then,
 * with the best ones first; ties keep catalogue order so the list does not
 * reshuffle under the reader as they type.
 */
export function filterGuides(list, { q = '', region = '', month = 0 } = {}) {
  const words = foldText(q).split(/\s+/).filter(Boolean);
  const out = list.filter((j) => {
    if (region && j.region !== region) return false;
    const fit = month ? monthFit(j, month) : 'best';
    if (fit !== 'best' && fit !== 'good') return false;
    if (!words.length) return true;
    const hay = j.search || foldText([j.title, j.place, j.country, ...(j.mood || [])].join(' '));
    return words.every((w) => hay.includes(w));
  });
  if (!month) return out;
  return out
    .map((j, i) => ({ j, i }))
    .sort((a, b) => (FIT_RANK[monthFit(a.j, month)] - FIT_RANK[monthFit(b.j, month)]) || a.i - b.i)
    .map(({ j }) => j);
}

/**
 * The month to suggest when someone has not picked one: the next best month
 * after this one, so there is time to plan, falling back to a good one.
 */
export function suggestedMonth(j, today = new Date()) {
  const now = today.getMonth() + 1;
  const ahead = Array.from({ length: 12 }, (_, i) => ((now + i) % 12) + 1);
  return ahead.find((m) => j.months.best.includes(m))
    || ahead.find((m) => j.months.good.includes(m))
    || ahead[0];
}

/** A month is next year once this year's has begun. */
export function yearFor(month, today = new Date()) {
  return today.getFullYear() + (month < today.getMonth() + 1 ? 1 : 0);
}

function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function clampDays(j, days) {
  const n = Math.round(Number(days)) || Math.round((j.days[0] + j.days[1]) / 2);
  return Math.max(1, Math.min(30, n));
}

export const BRIEF_LIMIT = 5800;

const withNames = (text, names) => String(text || '').replace(/\{(p\d+)\}/g, (m, id) => names.get(id) || '');

/**
 * A guide plus someone's choices, as a request the planner can act on.
 *
 * Written to leave nothing for the planner's clarifying step to ask: when, how
 * long, who and how fast are always said. The kept places carry their notes,
 * because "go at opening time" is exactly the kind of detail that decides where
 * a stop lands in a day.
 *
 * choice: { mode: 'dates' | 'month', start, month, days, who, pace, dropped: [placeId], extra }
 */
export function composeBrief(doc, choice, today = new Date()) {
  const days = clampDays(doc, choice.days);
  const dropped = new Set(choice.dropped || []);
  const places = doc.places || [];
  const names = new Map(places.map((p) => [p.id, p.name]));
  const lines = [`Plan my own version of “${doc.title}”, a Wander guide through ${placeLine(doc)}.`, ''];

  if (choice.mode === 'dates' && /^\d{4}-\d{2}-\d{2}$/.test(choice.start || '')) {
    lines.push(`Dates: ${choice.start} to ${addDaysISO(choice.start, days - 1)} (${days} days).`);
  } else {
    const month = Number(choice.month) || suggestedMonth(doc, today);
    lines.push(`When: ${MONTHS[month - 1]} ${yearFor(month, today)}, for ${days} days. Choose sensible dates in that month.`);
  }
  const who = WHO.find((w) => w.id === choice.who);
  if (who) lines.push(`Who: ${who.brief}.`);
  const pace = PACES.find((p) => p.id === choice.pace) || PACES[1];
  lines.push(`Pace: ${pace.brief}.`);

  const kept = places.filter((p) => !dropped.has(p.id));
  const left = places.filter((p) => dropped.has(p.id));
  if (kept.length) lines.push('', 'Build the days around these places:', ...kept.map((p) => `- ${p.name}: ${p.note}`));
  if (left.length) lines.push('', `Leave out: ${left.map((p) => p.name).join('; ')}.`);

  const blocks = doc.blocks || [];
  const shape = blocks.filter((b) => b.type === 'heading')
    .map((b) => (b.kicker ? `${b.kicker} — ${b.text}` : b.text));
  if (shape.length) {
    lines.push('', 'The guide’s shape, as a guide rather than a schedule:', ...shape.map((s, i) => `${i + 1}. ${s}`));
  }
  lines.push(`Fit it into ${days} days: shorten or drop parts rather than rushing.`);

  const asides = blocks.filter((b) => ['tip', 'detour', 'skip'].includes(b.type))
    .map((b) => `- ${b.label || b.title || (b.type === 'skip' ? 'Skip' : 'Note')}: ${withNames(b.text, names)}`);
  const know = (doc.know || []).map((k) => `- ${k.label}: ${k.text}`);
  if (asides.length || know.length) lines.push('', 'Good to know:', ...asides, ...know);

  const extra = String(choice.extra || '').trim();
  if (extra) lines.push('', `Also: ${extra}`);

  return lines.join('\n').slice(0, BRIEF_LIMIT);
}

/** The short line shown back on the planning screen while the brief works. */
export function briefTitle(j) {
  return `My version of ${j.title}`;
}
