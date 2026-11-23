'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, RotateCw } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { catColor } from '@/components/GoogleMap';

/*
 * How long a preview may take before it is called a failure.
 *
 * Nothing used to bound this: the token lookup waits on the auth SDK's lock,
 * which another tab (or a refresh stuck on a bad connection) can hold
 * indefinitely, and then "Loading map preview" spun for as long as the editor
 * was open. A cold function plus Google's render is a few seconds; past this
 * it is not coming, and saying so offers the way round it.
 */
const PATIENCE = 12000;
const SESSION_PATIENCE = 4000;

function within(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export default function StaticActivityMap({ at, pinned, category, compact, title }) {
  const { supabase, session } = useApp();
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(0);
  /*
   * The token the app already holds, read without asking the SDK.
   *
   * AppProvider keeps the session current through every refresh, so this is
   * nearly always good. Only a rejection sends the request through
   * getSession, which is the call that can stall.
   */
  const held = useRef('');
  useEffect(() => { held.current = session?.access_token || ''; }, [session]);
  useEffect(() => { setReady(true); }, []);
  const color = ready ? catColor(category).replace('#', '') : '';
  const query = new URLSearchParams({ lat: String(at.lat), lng: String(at.lng),
    type: 'roadmap', theme: 'light', pin: pinned ? '1' : '0',
    compact: compact ? '1' : '0', color }).toString();

  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    let gone = false;
    let objectURL;
    const deadline = setTimeout(() => controller.abort(), PATIENCE);

    async function token(fresh) {
      if (!fresh && held.current) return held.current;
      if (!supabase) return '';
      const { data } = await within(supabase.auth.getSession(), SESSION_PATIENCE);
      return data?.session?.access_token || '';
    }
    const ask = (bearer) => fetch(`/api/maps/static?${query}`, {
      headers: { Authorization: `Bearer ${bearer}` }, signal: controller.signal,
    });

    (async () => {
      try {
        const first = await token(false);
        if (!first) throw new Error('Sign in required');
        let response = await ask(first);
        // A token that expired a moment ago: one fresh one, once.
        if (response.status === 401) {
          const fresh = await token(true);
          if (fresh && fresh !== first) response = await ask(fresh);
        }
        if (!response.ok) throw new Error('Preview unavailable');
        const blob = await response.blob();
        if (gone) return;
        objectURL = URL.createObjectURL(blob);
        setResult({ query, url: objectURL });
      } catch {
        if (!gone) setResult({ query, error: true });
      } finally {
        clearTimeout(deadline);
      }
    })();
    return () => {
      gone = true;
      clearTimeout(deadline);
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [query, ready, supabase, attempt]);

  const current = result?.query === query ? result : null;
  return <div className="amap-static">
    {current?.url && !current.error ? <img src={current.url}
      alt={`Map preview of ${title || 'this location'}`} draggable={false}
      onError={() => setResult({ query, error: true })} /> : <div className="amap-static-status" role="status">
      {current?.error ? <><MapPin size={22} /><span>Preview unavailable</span><small>Open the map to view this location.</small>
        <button type="button" className="btn sm amap-static-retry"
          onClick={() => { setResult(null); setAttempt((n) => n + 1); }}>
          <RotateCw size={13} /> Try again
        </button></>
        : <><Loader2 size={20} className="spin" /><span>Loading map preview</span></>}
    </div>}
  </div>;
}
