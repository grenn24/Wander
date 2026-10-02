'use client';
import { useEffect, useState } from 'react';
import { Download, Check, Loader2 } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import { listDownloads, removeDownload, saveDownload, tripSnapshot } from '@/public/offline-store';

export default function OfflineDownload() {
  const { user, supabase } = useApp();
  const { trip, ready } = useTrip();
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    listDownloads().then((rows) => { if (alive) setSaved(rows.find((r) => r.id === trip?.id)?.savedAt || null); }).catch(() => {});
    return () => { alive = false; };
  }, [trip?.id]);
  async function download() {
    if (!ready || !trip || !user) return;
    setBusy(true); setError('');
    try {
      if (!navigator.onLine) throw new Error('Connect to the internet before downloading a fresh copy.');
      if (!('serviceWorker' in navigator)) throw new Error('This browser cannot save the app for offline access. Use Print / PDF instead.');
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('The offline reader could not be saved. Check your connection and retry.')), 15000))]);
      // A failed or pending edit must not be advertised as a saved server copy.
      const [t, a, p] = await Promise.all([
        supabase.from('trips').select('*').eq('id', trip.id).single(),
        supabase.from('activities').select('*').eq('trip_id', trip.id),
        supabase.from('packing_items').select('*').eq('trip_id', trip.id),
      ]);
      if (t.error || a.error || p.error || !t.data) throw new Error('Could not download the complete trip. Check your connection and access, then retry.');
      const snapshot = tripSnapshot(user.id, t.data, a.data || [], p.data || []);
      await saveDownload(snapshot);
      setSaved(snapshot.savedAt);
      navigator.storage?.persist?.().catch(() => {});
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className="card tset offline-download">
    <h3 className="tset-h"><Download size={15} /> Take this trip offline</h3>
    <p className="tset-hint">Save the itinerary, addresses, booking references, notes and packing list on this device. Maps and live directions need a connection.</p>
    <div className="chiprow">
      <button className="btn" disabled={busy || !ready} onClick={download}>
        {busy ? <Loader2 size={15} className="spin" /> : saved ? <Check size={15} /> : <Download size={15} />}
        {busy ? 'Downloading' : saved ? 'Update offline copy' : 'Download for offline'}
      </button>
      {saved ? <><a className="btn" href={`/offline.html?trip=${encodeURIComponent(trip.id)}`}>Open saved trip</a>
        <button className="btn ghost" disabled={busy} onClick={async () => {
          try { await removeDownload(trip.id); setSaved(null); } catch (e) { setError(e.message); }
        }}>Remove download</button></> : null}
    </div>
    {saved ? <p className="tiny dim" role="status">Saved {new Date(saved).toLocaleString()}. Update this copy after changing your plans.</p> : null}
    <p className="tiny dim">Read only. Anyone using this browser can open downloaded trips. Signing out removes them.</p>
    {error ? <p className="err" role="alert">{error}</p> : null}
  </section>;
}
