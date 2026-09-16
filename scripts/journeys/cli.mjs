/*
 * The journey service.
 *
 *   npm run journeys -- status
 *   npm run journeys -- add "Utah's national parks by road in October, 9 to 11 days"
 *   npm run journeys -- discover --count 30      queue ideas the catalogue is missing
 *   npm run journeys -- write --limit 5          write queued journeys
 *   npm run journeys -- refresh --limit 10       re-check the least recently checked
 *   npm run journeys -- refresh --slug kyoto-blossom
 *   npm run journeys -- rewrite --slug peru-sacred-valley   write a journey again from scratch, same destination, season and length
 *   npm run journeys -- rewrite --limit 14       rewrite the hand-written defaults still in the catalogue
 *   npm run journeys -- rewrite --resume         continue from each saved attempt that did not pass, instead of writing again
 *   npm run journeys -- restyle --slug s         rewrite only the writing, keeping facts, places and media (no web research)
 *   npm run journeys -- safety [--slug s]        add the travel advisory level and trip risks where missing (--recheck redoes them)
 *   npm run journeys -- media [--slug s]         add photographs and a video where missing
 *   npm run journeys -- media --recheck          have the review agent look at existing ones too
 *   npm run journeys -- import-defaults          load the default journeys from lib/journeys.js (skips imported ones; --force replaces)
 *   npm run journeys -- sync [--dry]            copy every published journey from here to production
 *   npm run journeys -- export-defaults          save the defaults' checked photographs and videos into lib/journeyMedia.js
 *   npm run journeys -- weekly                   what the schedule runs
 *
 * Options: --parallel 2, --allow-no-photos, --days 30 (refresh), --out file.json (add, without saving),
 *          --prod (a local run against production, using PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY)
 *
 * Locally it reads .env.local; in GitHub Actions the same names come from secrets.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  db, prodDb, catalogue, queue, requeueStale, claim, start, written, store, fail, counts,
  publishedRows, syncPayload,
} from './db.mjs';
import {
  produce, resumeJourney, refreshJourney, restyleJourney, discoverIdeas, reviewMedia, rejectedOf, rewriteBrief, safetyFor,
  newTally, costLine,
} from './pipeline.mjs';
import { attachMedia, unsplashReady } from './unsplash.mjs';
import { attachVideos, youtubeReady } from './youtube.mjs';
import { verifyPlaces } from './verify.mjs';
import { MODEL, EFFORT } from './openai.mjs';
import { JOURNEYS } from '../../lib/journeys.js';
import { fromV1, normaliseDoc, summaryOf } from '../../lib/journeyFormat.js';
import { defaultDocs, mediaOf, withMedia } from '../../lib/journeyDefaults.js';
import { MEDIA } from '../../lib/journeyMedia.js';

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i += 1; }
  }
  return out;
}

const logger = (label) => (msg) => {
  const tag = String(label || '').slice(0, 30).padEnd(30);
  console.log(`${new Date().toISOString().slice(11, 19)}  ${tag}  ${msg}`);
};

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await fn(item);
    }
  }));
}

const needsPhotos = (doc) => (doc.cover && !doc.cover.photo)
  || doc.blocks.some((b) => b.type === 'photo' && (b.photos || []).length < (b.layout === 'pair' ? 2 : 1));
const needsVideos = (doc) => !doc.video || doc.blocks.some((b) => b.type === 'video' && !b.video);
const clipCount = (doc) => doc.blocks.filter((b) => b.type === 'video' && b.video).length;

async function writeRows(client, rows, ctx, parallel) {
  const list = await catalogue(client);
  await pool(rows, parallel, async (row) => {
    const log = logger(row.brief);
    try {
      // Never its own row: a brief listed as "already in the catalogue" is a
      // brief the writer steers away from, which is how a request for Utah's
      // national parks came back as a route around them.
      const others = list.filter((c) => c.id !== row.id);
      const out = await produce(row.brief, { ...ctx, catalogue: others, log });
      const slug = await store(client, row, out);
      list.push({ id: row.id, slug, title: out.doc.title, country: out.doc.country });
      log(`saved ${slug} as ${out.status}`);
    } catch (e) {
      log(`failed: ${e.message}`);
      await fail(client, row, e.message);
    }
  });
}

async function refreshRows(client, rows, ctx, parallel) {
  const list = await catalogue(client);
  await pool(rows, parallel, async (row) => {
    const log = logger(row.slug);
    try {
      const out = await refreshJourney(row, { ...ctx, catalogue: list.filter((c) => c.id !== row.id), log });
      await store(client, row, out, { changed: out.changed });
      log(`${out.changed ? 'updated' : 'checked'}, ${out.status}`);
    } catch (e) {
      log(`failed: ${e.message}`);
      await fail(client, row, e.message);
    }
  });
}

/** A new version that did not pass: the old text stays, and the attempt is kept to look at. */
async function keepOld(client, row, out, log, what) {
  const file = join(tmpdir(), `journey-${what}-${row.slug}.json`);
  writeFileSync(file, JSON.stringify(out, null, 2));
  log(`kept the old version: the ${what} ${out.verdict === 'reject' ? 'was rejected' : 'did not pass review'}. `
    + `${out.review.summary} Attempt saved to ${file}`);
  await fail(client, row, `The ${what} was not published: ${out.review.summary}`);
}

async function main() {
  const opt = parse(process.argv.slice(2));
  if (opt.prod) process.env.JOURNEYS_TARGET = 'prod';
  const command = opt._[0] || process.env.JOURNEY_COMMAND || 'help';
  const limit = Number(opt.limit || process.env.JOURNEY_LIMIT || 0) || null;
  const parallel = Math.max(1, Number(opt.parallel || process.env.JOURNEY_PARALLEL || 2));
  const tally = newTally();
  const ctx = { tally, allowNoPhotos: !!opt['allow-no-photos'] };

  if (command === 'help') {
    console.log('Commands: status, add, discover, write, refresh, rewrite, restyle, safety, media, import-defaults, export-defaults, sync, weekly. See scripts/journeys/cli.mjs.');
    return;
  }
  console.log(`journeys ${command}: ${MODEL()} at ${EFFORT()} effort, `
    + `photographs ${unsplashReady() ? 'on' : 'off (no UNSPLASH_ACCESS_KEY)'}, `
    + `videos ${youtubeReady() ? 'on' : 'off (no YOUTUBE_DATA_API_KEY)'}`);

  if (command === 'add') {
    const brief = (opt._.slice(1).join(' ') || process.env.JOURNEY_BRIEF || '').trim();
    if (!brief) throw new Error('Say what to write: npm run journeys -- add "Utah\'s national parks in October"');
    if (opt.out) {
      const out = await produce(brief, { ...ctx, catalogue: [], log: logger(brief) });
      writeFileSync(opt.out, JSON.stringify(out, null, 2));
      console.log(`wrote ${opt.out}: ${out.status}`);
    } else {
      const client = db();
      const [row] = await queue(client, [brief]);
      await writeRows(client, [await start(client, row)], ctx, 1);
    }
  } else if (command === 'write') {
    const client = db();
    await requeueStale(client);
    await writeRows(client, await claim(client, limit || 3), ctx, parallel);
  } else if (command === 'discover') {
    const client = db();
    const ideas = await discoverIdeas(await catalogue(client), Number(opt.count || 20), ctx);
    (await queue(client, ideas)).forEach((r) => console.log(`queued: ${r.brief}`));
  } else if (command === 'refresh') {
    const client = db();
    const rows = await written(client, {
      statuses: ['published', 'draft'],
      olderThanDays: opt.slug ? null : Number(opt.days || 30),
      slug: opt.slug || null,
      limit: limit || 10,
    });
    console.log(`${rows.length} to refresh`);
    await refreshRows(client, rows, ctx, parallel);
  } else if (command === 'rewrite') {
    // Written again from scratch, keeping the destination, season, length and
    // address. The old text stays live unless the new one passes review.
    const client = db();
    const rows = opt.slug
      ? await written(client, { slug: opt.slug, limit: 1 })
      : (await written(client, { statuses: ['published', 'draft'], limit: 500 }))
        .filter((r) => r.source === 'editorial').slice(0, limit || 3);
    console.log(`${rows.length} to rewrite`);
    const list = await catalogue(client);
    await pool(rows, parallel, async (row) => {
      const log = logger(row.slug);
      try {
        const old = normaliseDoc(row.doc);
        // A photograph Unsplash's hourly limit held back can be added later
        // with media; it is no reason to throw away a rewrite that passed.
        const runCtx = {
          ...ctx, allowNoPhotos: true, slug: row.slug, rejected: old.rejected || [],
          catalogue: list.filter((c) => c.id !== row.id), log,
        };
        const saved = join(tmpdir(), `journey-rewrite-${row.slug}.json`);
        const attempt = opt.resume && existsSync(saved) ? JSON.parse(readFileSync(saved, 'utf8')).doc : null;
        const out = attempt
          ? await resumeJourney(attempt, rewriteBrief(old), runCtx)
          : await produce(rewriteBrief(old), runCtx);
        if (out.status !== 'published') { await keepOld(client, row, out, log, 'rewrite'); return; }
        await store(client, row, { ...out, source: 'generated' });
        log(`rewritten: ${out.review.score}/10, ${out.doc.places.length} places, ${out.doc.blocks.length} blocks`);
      } catch (e) {
        log(`failed: ${e.message}`);
        await fail(client, row, e.message);
      }
    });
  } else if (command === 'restyle') {
    const client = db();
    // Restyling keeps what a journey says, so it suits journeys the service
    // researched; the hand-written defaults are too thin and need rewrite.
    const rows = (await written(client, { statuses: ['published'], slug: opt.slug || null, limit: 500 }))
      .filter((r) => opt.slug || r.source !== 'editorial')
      .slice(0, limit || 3);
    console.log(`${rows.length} to restyle`);
    const list = await catalogue(client);
    await pool(rows, parallel, async (row) => {
      const log = logger(row.slug);
      try {
        const out = await restyleJourney(row, {
          ...ctx, allowNoPhotos: true, catalogue: list.filter((c) => c.id !== row.id), log,
        });
        if (out.status !== 'published') { await keepOld(client, row, out, log, 'restyle'); return; }
        await store(client, row, out);
        log(`restyled: ${out.review.score}/10, ${out.doc.blocks.length} blocks`);
      } catch (e) {
        log(`failed: ${e.message}`);
        await fail(client, row, e.message);
      }
    });
  } else if (command === 'safety') {
    const client = db();
    const rows = (await written(client, { statuses: ['published', 'draft'], slug: opt.slug || null, limit: 500 }))
      .filter((r) => opt.recheck || !(r.doc && r.doc.safety))
      .slice(0, limit || 50);
    console.log(`${rows.length} need a safety note`);
    await pool(rows, parallel, async (row) => {
      const log = logger(row.slug);
      try {
        const safety = await safetyFor(normaliseDoc(row.doc), ctx);
        if (!safety) { log('no usable safety note came back'); return; }
        // Only the safety note changes, read fresh so nothing saved meanwhile is lost.
        const { data: fresh, error } = await client.from('journeys').select('doc').eq('id', row.id).single();
        if (error) throw new Error(error.message);
        const doc = { ...fresh.doc, safety };
        const { error: saveError } = await client.from('journeys')
          .update({ doc, summary: summaryOf(doc), updated_at: new Date().toISOString() }).eq('id', row.id);
        if (saveError) throw new Error(saveError.message);
        log(`level ${safety.level}: ${safety.advice.slice(0, 90)}${safety.advice.length > 90 ? '…' : ''} | watch: ${safety.watch.join(', ')}`);
      } catch (e) {
        log(`failed: ${e.message}`);
      }
    });
  } else if (command === 'sync') {
    /*
     * Journeys are written and reviewed here; production is a copy. Only
     * published ones travel, matched by slug, so a journey keeps its address
     * and one already there is updated rather than added again. Nothing comes
     * back the other way: production is never where the work happens.
     */
    const here = db();
    const there = prodDb();
    const rows = await publishedRows(here);
    const { data: already, error } = await there.from('journeys').select('slug, version');
    if (error) throw new Error(`Reading production: ${error.message}`);
    const have = new Map((already || []).map((r) => [r.slug, r.version]));
    console.log(`${rows.length} published here, ${have.size} in production${opt.dry ? ' (a dry run changes nothing)' : ''}`);
    let changed = 0;
    for (const row of rows) {
      const log = logger(row.slug);
      const known = have.has(row.slug);
      if (have.get(row.slug) === row.version) { log(`already there at v${row.version}`); continue; }
      if (opt.dry) { log(`would ${known ? 'update' : 'add'} at v${row.version}`); continue; }
      const { error: saveError } = await there.from('journeys').upsert(syncPayload(row), { onConflict: 'slug' });
      if (saveError) { log(`failed: ${saveError.message}`); continue; }
      changed += 1;
      log(`${known ? 'updated' : 'added'} at v${row.version}`);
    }
    console.log(opt.dry ? 'a dry run: nothing was written' : `${changed} journeys written to production`);
  } else if (command === 'media') {
    if (!unsplashReady() && !youtubeReady()) throw new Error('Set UNSPLASH_ACCESS_KEY or YOUTUBE_DATA_API_KEY first.');
    const client = db();
    const recheck = !!opt.recheck;
    // Photographs come fifty requests an hour, so they go first where they
    // matter most: a draft waiting on a cover to publish, then any journey
    // without a cover, then the rest.
    const urgency = (r) => (r.status === 'draft' ? 0 : 2) + (r.doc.cover && r.doc.cover.photo ? 1 : 0);
    const rows = (await written(client, { statuses: ['draft', 'published'], slug: opt.slug || null, limit: 500 }))
      .filter((r) => recheck || (unsplashReady() && needsPhotos(r.doc)) || (youtubeReady() && needsVideos(r.doc)))
      .sort((a, b) => urgency(a) - urgency(b))
      .slice(0, limit || 20);
    for (const row of rows) {
      const log = logger(row.slug);
      const doc = row.doc;
      const rejected = rejectedOf(doc);
      const attach = async () => (await attachMedia(doc, { rejected, log })) + (await attachVideos(doc, { rejected, log }));
      const missesBefore = JSON.stringify(doc.photoMisses || {});
      const added = await attach();
      if (!added && !recheck) {
        // Remember what came up empty, so the next rounds spend their requests elsewhere.
        if (JSON.stringify(doc.photoMisses || {}) !== missesBefore) {
          const { data: fresh } = await client.from('journeys').select('doc').eq('id', row.id).maybeSingle();
          if (fresh && fresh.doc) {
            await client.from('journeys').update({ doc: { ...fresh.doc, photoMisses: doc.photoMisses } }).eq('id', row.id);
          }
        }
        log('nothing new found');
        continue;
      }
      await reviewMedia(doc, rejected, log, ctx);
      const photos = (doc.cover && doc.cover.photo ? 1 : 0)
        + doc.blocks.reduce((n, b) => n + (b.photos || []).length, 0);
      // A media run can take minutes; keep a safety note saved meanwhile rather than writing over it.
      const { data: fresh } = await client.from('journeys').select('doc').eq('id', row.id).maybeSingle();
      if (fresh && fresh.doc && fresh.doc.safety && !doc.safety) doc.safety = fresh.doc.safety;
      const passed = row.review && row.review.verdict === 'publish';
      const status = row.status === 'draft' && passed && doc.cover && doc.cover.photo ? 'published' : row.status;
      await store(client, row, { doc, status, review: row.review, verification: (row.review && row.review.verification) || [] });
      log(`${photos} photographs, ${doc.video ? `video "${doc.video.title}"` : 'no video'}, ${clipCount(doc)} section videos, ${status}`);
    }
  } else if (command === 'import-defaults') {
    const client = db();
    for (const base of defaultDocs()) {
      const log = logger(base.slug);
      const { data: existing } = await client.from('journeys').select('*').eq('slug', base.slug).maybeSingle();
      // Once imported, a journey belongs to the database: a refresh may have
      // rewritten it since, and importing again would put the old text back.
      if (existing && !opt.force) { log('already imported, skipped (--force replaces it)'); continue; }
      const checked = await verifyPlaces(base);
      const doc = checked.doc;
      const rejected = rejectedOf(doc);
      // The photographs and video that ship with a default were checked when
      // they were chosen; only what this run has to find needs another look.
      const added = (await attachMedia(doc, { rejected, log })) + (await attachVideos(doc, { rejected, log }));
      if (added) await reviewMedia(doc, rejected, log, ctx);
      let row = existing;
      if (!row) {
        const { data, error } = await client.from('journeys')
          .insert({ brief: base.title, status: 'working', source: 'editorial' }).select().single();
        if (error) throw new Error(`Importing ${base.slug}: ${error.message}`);
        row = data;
      }
      await store(client, row, {
        doc,
        status: 'published',
        review: { verdict: 'publish', score: null, summary: 'Written by hand.', issues: [] },
        verification: checked.issues,
      });
      log(`imported, ${checked.issues.length} place notes${doc.cover.photo ? '' : ', no photographs yet'}`);
      checked.issues.forEach((i) => log(`  ${i.severity}: ${i.problem}`));
    }
  } else if (command === 'export-defaults') {
    // Run where the defaults' media was chosen and checked, then commit the
    // file: the site's stand-in journeys and import-defaults both read it.
    const client = db();
    const media = { ...MEDIA };
    for (const j of JOURNEYS) {
      const { data: row, error } = await client.from('journeys').select('doc')
        .eq('slug', j.slug).eq('status', 'published').maybeSingle();
      if (error) throw new Error(`Reading ${j.slug}: ${error.message}`);
      if (!row) { console.log(`${j.slug}: not published in this database, left as it was`); continue; }
      media[j.slug] = mediaOf(row.doc);
      const shipped = withMedia(fromV1(j), media[j.slug]);
      const photos = (shipped.cover.photo ? 1 : 0) + shipped.blocks.reduce((n, b) => n + (b.photos || []).length, 0);
      console.log(`${j.slug}: ${photos} photographs, ${shipped.video ? 'a video' : 'no video'}`);
    }
    writeFileSync(new URL('../../lib/journeyMedia.js', import.meta.url), '/* eslint-disable */\n'
      + '// Written by `npm run journeys -- export-defaults`; do not edit by hand.\n'
      + `export const MEDIA = ${JSON.stringify(media, null, 2)};\n`);
    console.log('wrote lib/journeyMedia.js');
  } else if (command === 'weekly') {
    const client = db();
    await refreshRows(client, await written(client, { statuses: ['published'], olderThanDays: 30, limit: 10 }), ctx, parallel);
    const { by } = await counts(client);
    if ((by.queued || 0) < 5) {
      const ideas = await discoverIdeas(await catalogue(client), 10, ctx);
      await queue(client, ideas);
    }
    await requeueStale(client);
    await writeRows(client, await claim(client, limit || 3), ctx, parallel);
  } else if (command === 'status') {
    const { by, oldest } = await counts(db());
    console.log(JSON.stringify(by));
    console.log(`least recently checked published journey: ${oldest || 'none'}`);
  } else {
    throw new Error(`Unknown command "${command}".`);
  }

  if (tally.calls) console.log(costLine(tally, MODEL()));
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
