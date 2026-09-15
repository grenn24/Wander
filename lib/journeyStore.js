import { createClient } from '@supabase/supabase-js';
import { summaryOf } from './journeyFormat.js';
import { defaultDocs } from './journeyDefaults.js';
import { countryCode } from './countries.js';

/* The flag's country code, worked out here so the name table stays on the server. */
const flagged = (x) => (x ? { ...x, flag: countryCode(x.country) } : x);

/*
 * Where published journeys are read from.
 *
 * The database is the catalogue. The hand-written journeys also ship with the
 * code and stand in whenever the database has nothing published — before the
 * migration has run, or when it cannot be reached — so the page is never
 * empty because an operations step has not happened yet.
 *
 * Read with the public key: the table lets anyone read published rows and
 * nothing else, so this needs no secret and can run at build time.
 */
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const usable = (v) => !!v && !v.startsWith('REPLACE_WITH');

function reader() {
  if (!usable(URL) || !usable(ANON)) return null;
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}

let bundled = null;
export function editorialDocs() {
  if (!bundled) bundled = defaultDocs();
  return bundled;
}

export async function publishedSummaries() {
  const db = reader();
  if (db) {
    const { data, error } = await db.from('journeys').select('summary')
      .eq('status', 'published').not('summary', 'is', null)
      .order('published_at', { ascending: true })
      .limit(3000);
    if (error) console.error('[journeys] catalogue read failed:', error.message);
    else if (data && data.length) return data.map((r) => flagged(r.summary));
  }
  return editorialDocs().map((d) => flagged(summaryOf(d)));
}

export async function journeyDoc(slug) {
  const db = reader();
  if (db) {
    const { data, error } = await db.from('journeys').select('doc')
      .eq('slug', slug).eq('status', 'published').maybeSingle();
    if (error) console.error(`[journeys] read of ${slug} failed:`, error.message);
    else if (data && data.doc) return flagged(data.doc);
  }
  return flagged(editorialDocs().find((d) => d.slug === slug) || null);
}
