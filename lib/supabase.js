'use client';
import { createClient } from '@supabase/supabase-js';

// Config comes from the environment only. These are inlined at build time, so
// they must be read as full `process.env.X` expressions, not destructured.
const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ENV_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function readConfig() {
  if (ENV_URL && ENV_KEY) return { url: ENV_URL, key: ENV_KEY };
  return null;
}

/** Names of the env vars that are missing, for the error screen to report. */
export function missingEnv() {
  const missing = [];
  if (!ENV_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!ENV_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return missing;
}

/**
 * A postgres:// string here is a common mix-up: the browser needs the Supabase
 * HTTP API, not the database port. Worth naming explicitly, because the failure
 * would otherwise surface as an opaque fetch error on every request.
 */
export function configWarning() {
  if (!ENV_URL) return '';
  if (/^postgres(ql)?:\/\//i.test(ENV_URL)) {
    return 'NEXT_PUBLIC_SUPABASE_URL is a Postgres connection string. It needs the Supabase API URL instead (http://…), for example http://127.0.0.1:54321.';
  }
  if (!/^https?:\/\//i.test(ENV_URL)) {
    return 'NEXT_PUBLIC_SUPABASE_URL should start with http:// or https://.';
  }
  return '';
}

let cached = null;
let cachedUrl = null;

export function getClient() {
  const cfg = readConfig();
  if (!cfg) return null;
  if (cached && cachedUrl === cfg.url) return cached;
  cached = createClient(cfg.url, cfg.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 8 } },
  });
  cachedUrl = cfg.url;
  return cached;
}
