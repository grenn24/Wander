/*
 * The journey service.
 *
 *   npm run journeys -- status
 *   npm run journeys -- add "Utah's national parks by road in October, 9 to 11 days"
 *   npm run journeys -- discover --count 30      queue ideas the catalogue is missing
 *   npm run journeys -- write --limit 5          write queued journeys
 *   npm run journeys -- refresh --limit 10       re-check the least recently checked
 *   npm run journeys -- refresh --slug kyoto-blossom
 *   npm run journeys -- media [--slug s]         add photographs and a video where missing
 *   npm run journeys -- media --recheck          have the review agent look at existing ones too
 *   npm run journeys -- import-editorial         load the hand-written journeys
 *   npm run journeys -- weekly                   what the schedule runs
 *
 * Options: --parallel 2, --allow-no-photos, --days 30 (refresh), --out file.json (add, without saving)
 *
 * Locally it reads .env.local; in GitHub Actions the same names come from secrets.
 */
import { writeFileSync } from 'node:fs';
import {
  db, catalogue, queue, requeueStale, claim, start, written, store, fail, counts,
} from './db.mjs';
import {
  produce, refreshJourney, discoverIdeas, checkMedia, dropRejected, newTally, costLine,
} from './pipeline.mjs';
import { attachMedia, unsplashReady } from './unsplash.mjs';
import { attachVideo, youtubeReady } from './youtube.mjs';
import { verifyPlaces } from './verify.mjs';
import { MODEL, EFFORT } from './openai.mjs';
import { JOURNEYS } from '../../lib/journeys.js';
import { fromV1 } from '../../lib/journeyFormat.js';

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

async function main() {
  const opt = parse(process.argv.slice(2));
  const command = opt._[0] || process.env.JOURNEY_COMMAND || 'help';
  const limit = Number(opt.limit || process.env.JOURNEY_LIMIT || 0) || null;
  const parallel = Math.max(1, Number(opt.parallel || process.env.JOURNEY_PARALLEL || 2));
  const tally = newTally();
  const ctx = { tally, allowNoPhotos: !!opt['allow-no-photos'] };

  if (command === 'help') {
    console.log('Commands: status, add, discover, write, refresh, media, import-editorial, weekly. See scripts/journeys/cli.mjs.');
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
  } else if (command === 'media') {
    if (!unsplashReady() && !youtubeReady()) throw new Error('Set UNSPLASH_ACCESS_KEY or YOUTUBE_DATA_API_KEY first.');
    const client = db();
    const recheck = !!opt.recheck;
    const rows = (await written(client, { statuses: ['draft', 'published'], slug: opt.slug || null, limit: 500 }))
      .filter((r) => recheck || (unsplashReady() && needsPhotos(r.doc)) || (youtubeReady() && !r.doc.video))
      .slice(0, limit || 20);
    for (const row of rows) {
      const log = logger(row.slug);
      const doc = row.doc;
      const rejected = new Set();
      const attach = async () => (await attachMedia(doc, { rejected, log })) + (await attachVideo(doc, { rejected, log }));
      const added = await attach();
      if (!added && !recheck) { log('nothing new found'); continue; }
      // Nothing reaches readers unchecked: the review agent looks at what was
      // added here, as it does for a journey it reviews in full.
      for (let round = 1; round <= 3; round += 1) {
        const verdict = await checkMedia(doc, ctx);
        const dropped = dropRejected(doc, verdict, rejected);
        if (!dropped) break;
        log(`turned down ${dropped}: ${verdict.reason}`);
        if (round < 3) await attach();
      }
      const photos = (doc.cover && doc.cover.photo ? 1 : 0)
        + doc.blocks.reduce((n, b) => n + (b.photos || []).length, 0);
      const passed = row.review && row.review.verdict === 'publish';
      const status = row.status === 'draft' && passed && doc.cover && doc.cover.photo ? 'published' : row.status;
      await store(client, row, { doc, status, review: row.review, verification: (row.review && row.review.verification) || [] });
      log(`${photos} photographs, ${doc.video ? `video "${doc.video.title}"` : 'no video'}, ${status}`);
    }
  } else if (command === 'import-editorial') {
    const client = db();
    for (const j of JOURNEYS) {
      const log = logger(j.slug);
      const checked = await verifyPlaces(fromV1(j));
      const doc = checked.doc;
      await attachMedia(doc, { log });
      await attachVideo(doc, { log });
      const { data: existing } = await client.from('journeys').select('*').eq('slug', j.slug).maybeSingle();
      let row = existing;
      if (!row) {
        const { data, error } = await client.from('journeys')
          .insert({ brief: j.title, status: 'working', source: 'editorial' }).select().single();
        if (error) throw new Error(`Importing ${j.slug}: ${error.message}`);
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
