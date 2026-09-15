import { createClient } from '@supabase/supabase-js';
import { summaryOf } from '../../lib/journeyFormat.js';

/*
 * The journeys table, from the service's side: the service role, which is the
 * only thing allowed to write to it.
 */
const now = () => new Date().toISOString();

export function db() {
  // A local run with --prod writes to production. Its settings have names of
  // their own, so the local app, which reads the usual ones, never touches it.
  const prod = process.env.JOURNEYS_TARGET === 'prod';
  const url = (prod ? process.env.PROD_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL) || '';
  const key = (prod ? process.env.PROD_SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY) || '';
  if (!url || url.startsWith('REPLACE_WITH') || !key || key.startsWith('REPLACE_WITH')) {
    throw new Error(prod
      ? 'Set PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY in .env.local to write to production.'
      : 'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to write journeys.');
  }
  if (prod) console.log(`writing to production at ${new URL(url).host}`);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function check(error, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Everything written or waiting to be, for the writer to avoid repeating. */
export async function catalogue(client) {
  const { data, error } = await client.from('journeys')
    .select('id, slug, status, brief, summary')
    .in('status', ['published', 'draft', 'working', 'queued']);
  check(error, 'Reading the catalogue');
  return data.map((r) => ({
    id: r.id,
    slug: r.slug,
    status: r.status,
    title: (r.summary && r.summary.title) || r.brief,
    country: (r.summary && r.summary.country) || '',
    region: (r.summary && r.summary.region) || '',
    months: (r.summary && r.summary.months) || null,
  }));
}

export async function queue(client, briefs, source = 'generated') {
  if (!briefs.length) return [];
  const { data, error } = await client.from('journeys')
    .insert(briefs.map((brief) => ({ brief, status: 'queued', source })))
    .select();
  check(error, 'Queueing journeys');
  return data;
}

/** A run that died mid-journey leaves rows marked working; put them back. */
export async function requeueStale(client) {
  const cutoff = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { error } = await client.from('journeys')
    .update({ status: 'queued', updated_at: now() })
    .eq('status', 'working').is('doc', null).lt('updated_at', cutoff);
  check(error, 'Requeueing stale journeys');
}

/** Take queued briefs, one row at a time so two runs never take the same one. */
export async function claim(client, limit) {
  const { data, error } = await client.from('journeys')
    .select('*').eq('status', 'queued').order('created_at').limit(limit);
  check(error, 'Reading the queue');
  const taken = [];
  for (const row of data) {
    const { data: got } = await client.from('journeys')
      .update({ status: 'working', attempts: row.attempts + 1, updated_at: now() })
      .eq('id', row.id).eq('status', 'queued')
      .select().maybeSingle();
    if (got) taken.push(got);
  }
  return taken;
}

export async function start(client, row) {
  const { data, error } = await client.from('journeys')
    .update({ status: 'working', attempts: row.attempts + 1, updated_at: now() })
    .eq('id', row.id).select().single();
  check(error, 'Starting a journey');
  return data;
}

/** Journeys that exist, least recently checked first. */
export async function written(client, { statuses = ['published'], olderThanDays = null, slug = null, limit = 10 } = {}) {
  let q = client.from('journeys').select('*').not('doc', 'is', null);
  if (slug) q = q.eq('slug', slug);
  else {
    q = q.in('status', statuses);
    if (olderThanDays != null) {
      const cutoff = new Date(Date.now() - olderThanDays * 86400 * 1000).toISOString();
      q = q.or(`checked_at.is.null,checked_at.lt.${cutoff}`);
    }
  }
  const { data, error } = await q.order('checked_at', { ascending: true, nullsFirst: true }).limit(limit);
  check(error, 'Reading journeys');
  return data;
}

/**
 * Save what the pipeline produced. A slug somebody else already has gets a
 * number on the end rather than failing the journey.
 */
export async function store(client, row, out, { changed = true } = {}) {
  const at = now();
  const doc = { ...out.doc, checked: at.slice(0, 10) };
  const base = doc.slug;
  for (let n = 1; n <= 6; n += 1) {
    doc.slug = n === 1 ? base : `${base}-${n}`;
    const patch = {
      slug: doc.slug,
      status: out.status,
      doc,
      summary: summaryOf(doc),
      review: { ...(out.review || {}), verification: out.verification || [], at },
      version: (row.version || 0) + (changed ? 1 : 0),
      checked_at: at,
      updated_at: at,
      last_error: out.status === 'published' ? null : ((out.review && out.review.summary) || null),
      ...(out.status === 'published' && !row.published_at ? { published_at: at } : {}),
    };
    const { error } = await client.from('journeys').update(patch).eq('id', row.id);
    if (!error) return doc.slug;
    if (error.code !== '23505') throw new Error(`Saving ${base}: ${error.message}`);
  }
  throw new Error(`No free slug for ${base}.`);
}

export async function fail(client, row, message) {
  await client.from('journeys').update({
    status: row.doc ? row.status : (row.attempts >= 3 ? 'rejected' : 'queued'),
    last_error: String(message).slice(0, 1000),
    updated_at: now(),
  }).eq('id', row.id);
}

export async function counts(client) {
  const { data, error } = await client.from('journeys').select('status, checked_at');
  check(error, 'Counting journeys');
  const by = {};
  data.forEach((r) => { by[r.status] = (by[r.status] || 0) + 1; });
  const oldest = data.filter((r) => r.status === 'published' && r.checked_at)
    .map((r) => r.checked_at).sort()[0] || null;
  return { by, oldest };
}
