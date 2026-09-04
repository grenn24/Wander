'use client';
import { useEffect, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { catColor } from '@/components/GoogleMap';

export default function StaticActivityMap({ at, pinned, category, compact, title }) {
  const { supabase } = useApp();
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState(null);
  useEffect(() => { setReady(true); }, []);
  const color = ready ? catColor(category).replace('#', '') : '';
  const query = new URLSearchParams({ lat: String(at.lat), lng: String(at.lng),
    type: 'roadmap', theme: 'light', pin: pinned ? '1' : '0',
    compact: compact ? '1' : '0', color }).toString();

  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    let objectURL;
    (async () => {
      try {
        const session = await supabase?.auth.getSession();
        const token = session?.data?.session?.access_token;
        if (controller.signal.aborted) return;
        if (!token) throw new Error('Sign in required');
        const response = await fetch(`/api/maps/static?${query}`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('Preview unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectURL = URL.createObjectURL(blob);
        setResult({ query, url: objectURL });
      } catch {
        if (!controller.signal.aborted) setResult({ query, error: true });
      }
    })();
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [query, ready, supabase]);

  const current = result?.query === query ? result : null;
  return <div className="amap-static">
    {current?.url && !current.error ? <img src={current.url}
      alt={`Map preview of ${title || 'this location'}`} draggable={false}
      onError={() => setResult({ query, error: true })} /> : <div className="amap-static-status" role="status">
      {current?.error ? <><MapPin size={22} /><span>Preview unavailable</span><small>Open the map to view this location.</small></>
        : <><Loader2 size={20} className="spin" /><span>Loading map preview…</span></>}
    </div>}
  </div>;
}
