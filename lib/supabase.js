'use client';
import { createClient } from '@supabase/supabase-js';

const KEY = 'tp.supabase.config';

const ENV_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ENV_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function readConfig() {
  if (ENV_URL && ENV_KEY) return { url: ENV_URL, key: ENV_KEY, source: 'env' };
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.url && parsed.key) {
      return { url: parsed.url, key: parsed.key, source: 'browser' };
    }
  } catch (e) { /* ignore */ }
  return null;
}

export function saveConfig(url, key) {
  window.localStorage.setItem(KEY, JSON.stringify({ url: url.trim().replace(/\/+$/, ''), key: key.trim() }));
}

export function clearConfig() {
  try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
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
