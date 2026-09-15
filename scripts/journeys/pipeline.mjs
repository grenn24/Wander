import { WRITER_SCHEMA, normaliseDoc, validateDoc, modelFields } from '../../lib/journeyFormat.js';
import { MONTHS } from '../../lib/journeyKit.js';
import { respond } from './openai.mjs';
import { verifyPlaces } from './verify.mjs';
import { attachMedia } from './unsplash.mjs';
import { attachVideo } from './youtube.mjs';
import {
  WRITER, REVISER, RESTYLER, REVIEWER, REVIEW_SCHEMA, DISCOVER, DISCOVER_SCHEMA, MEDIA_CHECK, MEDIA_SCHEMA,
  catalogueText, coverageText, voiceSample,
} from './prompts.mjs';

/*
 * How a journey is made.
 *
 *   write    the model researches and writes it
 *   verify   every place is looked up on Google Maps
 *   photos   Unsplash photographs for the cover and photo blocks
 *   review   a second model, with web search, decides: publish, revise, reject
 *   revise   the writer fixes what the review and the verification found
 *
 * Verify, photos and review repeat after each revision, up to three rounds. A
 * journey that never passes stays a draft with the review saved beside it.
 */

const today = () => new Date().toISOString().slice(0, 10);

export function newTally() {
  return { calls: 0, searches: 0, input: 0, cached: 0, output: 0, reasoning: 0 };
}

function spend(tally, r) {
  tally.calls += 1;
  tally.searches += r.searches || 0;
  tally.input += r.usage.input_tokens || 0;
  tally.cached += (r.usage.input_tokens_details && r.usage.input_tokens_details.cached_tokens) || 0;
  tally.output += r.usage.output_tokens || 0;
  tally.reasoning += (r.usage.output_tokens_details && r.usage.output_tokens_details.reasoning_tokens) || 0;
}

/*
 * What a run cost, so a weekly job cannot quietly become an expensive one.
 * gpt-5.5 prices as listed by OpenAI on 14 September 2026: per million tokens,
 * and per thousand web searches. Other models print tokens only.
 */
const PRICES = { 'gpt-5.5': { input: 5, cached: 0.5, output: 30, search: 10 } };

export function costLine(t, model) {
  const line = `${t.calls} model calls, ${t.searches} web searches, ${t.input.toLocaleString()} input `
    + `(${t.cached.toLocaleString()} cached) and ${t.output.toLocaleString()} output tokens `
    + `(${t.reasoning.toLocaleString()} of them reasoning)`;
  const p = PRICES[model];
  if (!p) return line;
  const dollars = ((t.input - t.cached) * p.input + t.cached * p.cached + t.output * p.output) / 1e6
    + (t.searches * p.search) / 1000;
  return `${line}, about $${dollars.toFixed(2)}`;
}

const blockingOf = (issues) => (issues || []).filter((i) => i.severity === 'blocking');

function structureIssues(v) {
  return [
    ...v.errors.map((e) => ({ severity: 'blocking', area: 'writing', where: 'structure', problem: e, fix: 'Correct the structure.' })),
    ...v.warnings.map((w) => ({ severity: 'minor', area: 'writing', where: 'structure', problem: w, fix: 'Vary the shape.' })),
  ];
}

function withSources(doc, sources) {
  const seen = new Set();
  doc.sources = [...(doc.sources || []), ...(sources || [])]
    .filter((s) => s && /^https?:\/\//.test(s.url) && !seen.has(s.url) && seen.add(s.url))
    .slice(0, 12);
  return doc;
}

/** Keep what was already resolved for places and photographs a revision left alone. */
function carry(prev, next) {
  const byQuery = new Map(prev.places.filter((p) => p.place_id).map((p) => [p.q, p]));
  next.places = next.places.map((p) => {
    const old = byQuery.get(p.q);
    if (!old) return p;
    const { place_id, lat, lng, address, google_name, google_status } = old;
    return { ...p, place_id, lat, lng, address, google_name, google_status };
  });
  const shots = new Map(prev.blocks.filter((b) => b.type === 'photo' && (b.photos || []).length)
    .map((b) => [`${b.query}|${b.layout}`, b.photos]));
  next.blocks = next.blocks.map((b) => (b.type === 'photo' && shots.has(`${b.query}|${b.layout}`)
    ? { ...b, photos: shots.get(`${b.query}|${b.layout}`) } : b));
  if (prev.cover && prev.cover.photo && prev.cover.query === next.cover.query) next.cover.photo = prev.cover.photo;
  if (prev.video && prev.videoQuery === next.videoQuery) next.video = prev.video;
  return next;
}

function photoNotes(doc) {
  const notes = [];
  if (doc.cover && doc.cover.photo) {
    notes.push({ block: -1, about: doc.cover.query, picture: doc.cover.photo.alt || '(no description)' });
  }
  doc.blocks.forEach((b, i) => {
    if (b.type !== 'photo') return;
    (b.photos || []).forEach((m) => notes.push({
      block: i, about: [b.query, b.caption].filter(Boolean).join(' — '), picture: m.alt || '(no description)',
    }));
  });
  return notes;
}

function mediaPacket(doc) {
  const v = doc.video;
  return {
    photographs: photoNotes(doc),
    video: v ? {
      title: v.title, channel: v.channel, published: v.publishedAt,
      minutes: Math.round((v.seconds || 0) / 60), views: v.views,
    } : null,
  };
}

export function dropRejected(doc, review, rejected) {
  let dropped = 0;
  if (review.videoReject && doc.video) {
    rejected.add(doc.video.id);
    doc.video = null;
    dropped += 1;
  }
  for (const i of review.photoRejects || []) {
    if (i === -1 && doc.cover && doc.cover.photo) {
      rejected.add(doc.cover.photo.id);
      doc.cover.photo = null;
      dropped += 1;
    } else if (doc.blocks[i] && doc.blocks[i].type === 'photo') {
      (doc.blocks[i].photos || []).forEach((m) => rejected.add(m.id));
      doc.blocks[i].photos = [];
      dropped += 1;
    }
  }
  // Kept with the journey, so the next run does not pay to find and turn down
  // the same video or photograph again.
  if (dropped) doc.rejected = [...new Set([...(doc.rejected || []), ...rejected])].slice(-100);
  return dropped;
}

/** Everything the review has already turned down for this journey. */
export function rejectedOf(doc) {
  return new Set((doc && doc.rejected) || []);
}

async function write(brief, ctx) {
  const r = await respond({
    name: 'journey',
    schema: WRITER_SCHEMA,
    instructions: WRITER(today()),
    // What stays the same across a run goes first, so OpenAI can bill it at
    // the cached rate; the brief, which is different every time, goes last.
    input: `${voiceSample()}\n\n${catalogueText(ctx.catalogue)}\n\nBrief: ${brief}`,
  });
  spend(ctx.tally, r);
  return withSources(normaliseDoc(r.data), r.sources);
}

async function revise(doc, problems, brief, ctx) {
  const r = await respond({
    name: 'journey',
    schema: WRITER_SCHEMA,
    instructions: REVISER(today()),
    // A restyle is corrected against the version it was rewritten from, not
    // against the web: without it a lost fact can only be guessed back.
    input: JSON.stringify({
      brief, problems, journey: modelFields(doc), ...(ctx.previous ? { previous_version: ctx.previous } : {}),
    }),
    search: !ctx.previous,
  });
  spend(ctx.tally, r);
  return carry(doc, withSources(normaliseDoc(r.data), [...(doc.sources || []), ...r.sources]));
}

async function review(doc, verification, ctx, mode, brief) {
  const structure = validateDoc(doc, { strict: ctx.strict !== false });
  const packet = {
    brief,
    journey: modelFields(doc),
    google_maps: doc.places.map((p) => ({
      id: p.id, name: p.name, found: p.google_name || null, address: p.address || null, status: p.google_status || null,
    })),
    ...mediaPacket(doc),
    verification,
    structure: structureIssues(structure),
    ...(ctx.previous ? { previous_version: ctx.previous } : {}),
  };
  const r = await respond({
    name: 'journey_review',
    schema: REVIEW_SCHEMA,
    instructions: REVIEWER(today(), mode),
    input: `${catalogueText(ctx.catalogue, doc.slug)}\n\nThe journey and what was checked:\n${JSON.stringify(packet)}`,
    search: !ctx.previous,
  });
  spend(ctx.tally, r);
  return { review: r.data, structure };
}

async function settle(start, ctx, { mode, brief, rounds }) {
  let doc = start;
  const rejected = rejectedOf(start);
  let last = null;
  for (let round = 1; round <= rounds; round += 1) {
    const checked = await verifyPlaces(doc, { recheck: mode === 'refresh' && round === 1 });
    doc = checked.doc;
    await attachMedia(doc, { rejected, log: ctx.log });
    await attachVideo(doc, { rejected, log: ctx.log });
    const { review: rv, structure } = await review(doc, checked.issues, ctx, mode, brief);
    ctx.log(`review ${round}: ${rv.verdict}, ${rv.score}/10. ${rv.summary}`);
    if (dropRejected(doc, rv, rejected)) {
      await attachMedia(doc, { rejected, log: ctx.log });
      await attachVideo(doc, { rejected, log: ctx.log });
    }
    last = { review: rv, verification: checked.issues, structure };
    const hard = [...blockingOf(checked.issues), ...structure.errors];
    if (rv.verdict === 'reject') return { doc, verdict: 'reject', ...last };
    if (rv.verdict === 'publish' && !hard.length) return { doc, verdict: 'publish', ...last };
    if (round === rounds) break;
    const problems = [...rv.issues, ...checked.issues, ...structureIssues(structure)];
    ctx.log(`revising ${problems.length} problems`);
    doc = await revise(doc, problems, brief, ctx);
  }
  return { doc, verdict: 'revise', ...last };
}

const hasCover = (doc) => !!(doc.cover && doc.cover.photo);

/*
 * The brief for writing an existing journey again: the same destination,
 * season and length, researched and written from nothing. The old places are
 * offered as a starting point, and the old text is not shown at all, so the
 * new journey cannot inherit its shape.
 */
export function rewriteBrief(doc) {
  const best = ((doc.months && doc.months.best) || []).map((m) => MONTHS[m - 1]).filter(Boolean);
  const [lo, hi] = doc.days || [];
  const facts = [
    doc.place && doc.place !== doc.country ? `${doc.place}, ${doc.country}` : doc.country,
    best.length ? `at its best in ${best.join(', ')}` : '',
    lo && hi ? (lo === hi ? `${lo} days` : `${lo} to ${hi} days`) : '',
    doc.pace ? `${String(doc.pace).toLowerCase()} pace` : '',
  ].filter(Boolean).join('; ');
  const lines = [
    `${facts}. ${doc.teaser || doc.title}`,
    `This replaces Wander's journey "${doc.title}", which was too short and generic. Keep its destination, season and length, and write it afresh from your own research, at full depth.`,
  ];
  if ((doc.places || []).length) {
    lines.push(`The old version's places, to keep, replace or add to: ${doc.places.map((p) => p.name).join('; ')}.`);
  }
  return lines.join(' ');
}

/** A new journey from a one-sentence brief. */
export async function produce(brief, ctx) {
  ctx.log('writing');
  const first = await write(brief, ctx);
  // A rewrite keeps the journey's address, and what was already turned down for it.
  if (ctx.slug) first.slug = ctx.slug;
  if (ctx.rejected && ctx.rejected.length) first.rejected = [...ctx.rejected];
  ctx.log(`written "${first.title}": ${first.places.length} places, ${first.blocks.length} blocks`);
  const out = await settle(first, ctx, { mode: 'new', brief, rounds: 3 });
  let status = 'draft';
  if (out.verdict === 'reject') status = 'rejected';
  else if (out.verdict === 'publish' && (hasCover(out.doc) || ctx.allowNoPhotos)) status = 'published';
  return { ...out, status };
}

/**
 * The same journey written again so it is easy to follow: every fact, place,
 * photograph and video kept, and no web research, so it costs a fraction of a
 * rewrite. The review compares it with the version before it.
 */
export async function restyleJourney(row, ctx) {
  const before = normaliseDoc(row.doc);
  const previous = modelFields(before);
  ctx.log('restyling');
  const r = await respond({
    name: 'journey',
    schema: WRITER_SCHEMA,
    instructions: RESTYLER(today()),
    input: `${voiceSample()}\n\nThe journey to rewrite:\n${JSON.stringify(previous)}`,
    search: false,
  });
  spend(ctx.tally, r);
  const first = carry(before, withSources(normaliseDoc(r.data), before.sources));
  first.slug = before.slug;
  if (before.rejected) first.rejected = before.rejected;
  ctx.log(`restyled: ${first.places.length} places, ${first.blocks.length} blocks`);
  const out = await settle(first, { ...ctx, previous }, { mode: 'restyle', brief: row.brief || before.title, rounds: 3 });
  const status = out.verdict === 'publish' && (hasCover(out.doc) || ctx.allowNoPhotos) ? 'published' : 'draft';
  return { ...out, status };
}

/**
 * An existing journey, checked against today. Places are looked up again,
 * the review hunts for anything out of date, and a revision replaces the
 * published text only once it passes review itself.
 */
export async function refreshJourney(row, ctx) {
  const before = normaliseDoc(row.doc);
  const strict = row.source !== 'editorial';
  const out = await settle(before, { ...ctx, strict }, {
    mode: 'refresh', brief: row.brief || before.title, rounds: 2,
  });
  const changed = JSON.stringify(modelFields(out.doc)) !== JSON.stringify(modelFields(before));
  const unsafe = blockingOf(out.review.issues).some((i) => i.area === 'accuracy' || i.area === 'safety');
  let status = row.status;
  let doc = before;
  if (out.verdict === 'publish') {
    doc = out.doc;
    if (hasCover(doc) || ctx.allowNoPhotos) status = 'published';
  } else if (out.verdict === 'reject' || unsafe) {
    // Better no journey than a wrong one. The attempt is kept to continue from.
    doc = out.doc;
    status = 'draft';
  }
  return { ...out, doc, status, changed: changed && doc === out.doc };
}

/**
 * The review agent's eye on photographs and a video added after a journey was
 * written. A quick look rather than a full review: nothing here needs the web,
 * only a judgement on whether each picture and the video fit the journey.
 */
export async function checkMedia(doc, ctx) {
  const packet = mediaPacket(doc);
  if (!packet.photographs.length && !packet.video) return { photoRejects: [], videoReject: false, reason: '' };
  const r = await respond({
    name: 'journey_media_check',
    schema: MEDIA_SCHEMA,
    instructions: MEDIA_CHECK,
    input: JSON.stringify({
      journey: {
        title: doc.title, place: doc.place, country: doc.country,
        when: doc.when, bestMonths: (doc.months && doc.months.best) || [],
        places: doc.places.map((p) => p.name),
      },
      ...packet,
    }),
    effort: 'low',
    search: false,
    maxOutput: 6000,
  });
  spend(ctx.tally, r);
  return r.data;
}

/** Ideas for journeys the catalogue is missing. */
export async function discoverIdeas(catalogueList, howMany, ctx) {
  const r = await respond({
    name: 'journey_ideas',
    schema: DISCOVER_SCHEMA,
    instructions: DISCOVER(today(), howMany),
    input: coverageText(catalogueList),
    effort: 'medium',
    search: false,
  });
  spend(ctx.tally, r);
  const seen = new Set();
  return r.data.ideas.map((i) => i.brief.trim())
    .filter((b) => b && !seen.has(b.toLowerCase()) && seen.add(b.toLowerCase()))
    .slice(0, howMany);
}
