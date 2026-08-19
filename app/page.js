'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClient, readConfig, clearConfig } from '@/lib/supabase';
import {
  colorFor, dayRange, initials, sortActs, todayISO, addDays,
  ensureLocalName, writeLocalName,
} from '@/lib/util';
import Setup from '@/components/Setup';
import Itinerary from '@/components/Itinerary';
import ActivityModal from '@/components/ActivityModal';
import MapView from '@/components/MapView';
import Budget from '@/components/Budget';
import Packing from '@/components/Packing';
import Notes from '@/components/Notes';
import People from '@/components/People';
import TripModal from '@/components/TripModal';

const TABS = [
  { id: 'itinerary', label: 'Itinerary', icon: '\u{1F5D3}' },
  { id: 'map',       label: 'Map',       icon: '\u{1F4CD}' },
  { id: 'budget',    label: 'Budget',    icon: '\u{1F4B0}' },
  { id: 'packing',   label: 'Packing',   icon: '\u{1F392}' },
  { id: 'notes',     label: 'Notes',     icon: '\u{1F4DD}' },
  { id: 'people',    label: 'People',    icon: '\u{1F465}' },
];

function nameOf(session, fallback) {
  if (!session || !session.user) return fallback;
  const meta = session.user.user_metadata || {};
  return meta.display_name || fallback;
}

export default function Page() {
  const [phase, setPhase] = useState('boot'); // boot | setup | error | app
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [fatal, setFatal] = useState('');

  const [displayName, setDisplayName] = useState('');
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [activities, setActivities] = useState([]);
  const [packing, setPacking] = useState([]);
  const [members, setMembers] = useState([]);
  const [online, setOnline] = useState([]);
  const [tab, setTab] = useState('itinerary');
  const [editing, setEditing] = useState(null);
  const [tripDraft, setTripDraft] = useState(null);
  const [theme, setTheme] = useState('system');
  const [toast, setToast] = useState('');

  const trip = useMemo(() => trips.find((t) => t.id === tripId) || null, [trips, tripId]);
  const days = useMemo(() => (trip ? dayRange(trip.start_date, trip.end_date) : []), [trip]);
  const user = session ? session.user : null;

  /* --------------------------------------------- boot + guest session --- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tp.theme');
      if (saved) setTheme(saved);
    } catch (e) { /* ignore */ }

    if (!readConfig()) { setPhase('setup'); return undefined; }
    const client = getClient();
    setSupabase(client);

    let sub;
    let alive = true;
    (async () => {
      const localName = ensureLocalName();
      let current = null;
      try {
        const { data } = await client.auth.getSession();
        current = data.session || null;
        if (!current) {
          const { data: anon, error } = await client.auth.signInAnonymously({
            options: { data: { display_name: localName } },
          });
          if (error) throw error;
          current = anon.session || null;
        }
      } catch (e) {
        if (!alive) return;
        setFatal(e && e.message ? e.message : 'Could not start a session.');
        setPhase('error');
        return;
      }
      if (!alive) return;
      setSession(current);
      setDisplayName(nameOf(current, localName));
      setPhase('app');
      const res = client.auth.onAuthStateChange((_evt, s) => { if (s) setSession(s); });
      sub = res.data.subscription;
    })();

    return () => { alive = false; if (sub) sub.unsubscribe(); };
  }, []);

  function effectiveDark() {
    if (typeof document === 'undefined') return false;
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr) return attr === 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(next) {
    setTheme(next);
    try {
      if (next === 'system') { localStorage.removeItem('tp.theme'); document.documentElement.removeAttribute('data-theme'); }
      else { localStorage.setItem('tp.theme', next); document.documentElement.setAttribute('data-theme', next); }
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------- data loads --- */
  const loadTrips = useCallback(async () => {
    if (!supabase) return [];
    const { data, error } = await supabase.from('trips').select('*').order('start_date', { ascending: true });
    if (error) { setToast(error.message); return []; }
    setTrips(data || []);
    setTripId((cur) => (cur && (data || []).some((t) => t.id === cur) ? cur : (data && data[0] ? data[0].id : null)));
    return data || [];
  }, [supabase]);

  const loadTripData = useCallback(async (id) => {
    if (!supabase || !id) { setActivities([]); setPacking([]); setMembers([]); return; }
    const [a, p, m] = await Promise.all([
      supabase.from('activities').select('*').eq('trip_id', id),
      supabase.from('packing_items').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('trip_members').select('*').eq('trip_id', id),
    ]);
    if (!a.error) setActivities((a.data || []).slice().sort(sortActs));
    if (!p.error) setPacking(p.data || []);
    if (!m.error) setMembers(m.data || []);
  }, [supabase]);

  const loadRef = useRef({ loadTrips, loadTripData });
  loadRef.current = { loadTrips, loadTripData };

  /* ------------------------------------ first load + share-link joining -- */
  useEffect(() => {
    if (phase !== 'app' || !supabase) return;
    (async () => {
      let joined = null;
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('join');
        if (code) {
          const { data, error } = await supabase.rpc('join_trip_by_code', { p_code: code });
          if (error) setToast(error.message);
          else joined = data;
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch (e) { /* ignore */ }
      await loadTrips();
      if (joined) setTripId(joined);
    })();
  }, [phase, supabase, loadTrips]);

  useEffect(() => { loadTripData(tripId); }, [tripId, loadTripData]);

  /* --------------------------------------------------------- realtime --- */
  useEffect(() => {
    if (!supabase || !tripId || !user) return undefined;
    const filter = `trip_id=eq.${tripId}`;
    const ch = supabase.channel(`trip-${tripId}`, { config: { presence: { key: user.id } } });
    const refresh = () => { loadRef.current.loadTripData(tripId); };

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_items', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` },
        () => { loadRef.current.loadTrips(); })
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState();
        const list = [];
        Object.keys(state).forEach((k) => {
          const entry = state[k][0];
          if (entry) list.push({ id: k, name: entry.name || 'Guest' });
        });
        setOnline(list);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') ch.track({ name: displayName || 'Guest' });
      });

    return () => { supabase.removeChannel(ch); setOnline([]); };
  }, [supabase, tripId, user, displayName]);

  /* -------------------------------------------------------- mutations --- */
  async function saveDisplayName(name) {
    const clean = (name || '').trim().slice(0, 40) || 'Guest';
    writeLocalName(clean);
    setDisplayName(clean);
    if (!supabase || !user) return;
    await supabase.auth.updateUser({ data: { display_name: clean } });
    await supabase.from('trip_members').update({ display_name: clean }).eq('user_id', user.id);
    loadTripData(tripId);
  }

  async function saveTrip(draft) {
    if (!supabase || !user) return;
    const payload = {
      name: (draft.name || '').trim() || 'Untitled trip',
      destination: draft.destination || '',
      start_date: draft.start_date || todayISO(),
      end_date: draft.end_date || draft.start_date || todayISO(),
      currency: draft.currency || 'SGD',
      budget: draft.budget === '' || draft.budget === null || draft.budget === undefined ? null : Number(draft.budget),
      updated_at: new Date().toISOString(),
    };
    if (draft.id) {
      const { error } = await supabase.from('trips').update(payload).eq('id', draft.id);
      if (error) { setToast(error.message); return; }
    } else {
      const { data, error } = await supabase.from('trips')
        .insert({ ...payload, owner_id: user.id }).select().single();
      if (error) { setToast(error.message); return; }
      if (data) setTripId(data.id);
    }
    setTripDraft(null);
    await loadTrips();
  }

  async function deleteTrip(id) {
    if (!supabase) return;
    const { error } = await supabase.from('trips').delete().eq('id', id);
    if (error) { setToast(error.message); return; }
    setTripId(null);
    await loadTrips();
  }

  async function leaveTrip(id) {
    if (!supabase || !user) return;
    const { error } = await supabase.from('trip_members').delete().eq('trip_id', id).eq('user_id', user.id);
    if (error) { setToast(error.message); return; }
    setTripId(null);
    await loadTrips();
  }

  async function saveActivity(draft) {
    if (!supabase || !tripId) return;
    const payload = {
      trip_id: tripId,
      day: draft.day,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      title: (draft.title || '').trim() || 'Untitled',
      category: draft.category || 'sightseeing',
      location: draft.location || '',
      lat: draft.lat === '' || draft.lat === null || draft.lat === undefined ? null : Number(draft.lat),
      lng: draft.lng === '' || draft.lng === null || draft.lng === undefined ? null : Number(draft.lng),
      cost: Number(draft.cost || 0),
      booking_ref: draft.booking_ref || '',
      notes: draft.notes || '',
      sort_order: draft.sort_order || 0,
      updated_at: new Date().toISOString(),
    };
    const q = draft.id
      ? supabase.from('activities').update(payload).eq('id', draft.id)
      : supabase.from('activities').insert(payload);
    const { error } = await q;
    if (error) { setToast(error.message); return; }
    setEditing(null);
    loadTripData(tripId);
  }

  async function deleteActivity(id) {
    if (!supabase) return;
    const { error } = await supabase.from('activities').delete().eq('id', id);
    if (error) { setToast(error.message); return; }
    setEditing(null);
    loadTripData(tripId);
  }

  async function moveActivity(act, deltaDays) {
    if (!supabase) return;
    const next = addDays(act.day, deltaDays);
    if (!days.includes(next)) return;
    const { error } = await supabase.from('activities')
      .update({ day: next, updated_at: new Date().toISOString() }).eq('id', act.id);
    if (error) { setToast(error.message); return; }
    loadTripData(tripId);
  }

  async function addPacking(item) {
    if (!supabase || !tripId) return;
    const { error } = await supabase.from('packing_items').insert({ trip_id: tripId, ...item });
    if (error) setToast(error.message); else loadTripData(tripId);
  }
  async function updatePacking(id, patch) {
    if (!supabase) return;
    const { error } = await supabase.from('packing_items').update(patch).eq('id', id);
    if (error) setToast(error.message); else loadTripData(tripId);
  }
  async function deletePacking(id) {
    if (!supabase) return;
    const { error } = await supabase.from('packing_items').delete().eq('id', id);
    if (error) setToast(error.message); else loadTripData(tripId);
  }

  async function saveNotes(text) {
    if (!supabase || !tripId) return;
    const { error } = await supabase.from('trips')
      .update({ notes: text, updated_at: new Date().toISOString() }).eq('id', tripId);
    if (error) setToast(error.message);
    else setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, notes: text } : t)));
  }

  async function removeMember(uid) {
    if (!supabase || !tripId) return;
    const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', uid);
    if (error) setToast(error.message); else loadTripData(tripId);
  }

  /* ----------------------------------------------------------- render --- */
  if (phase === 'boot') {
    return <div className="gate"><div className="muted">Loading…</div></div>;
  }

  if (phase === 'setup') {
    return <Setup onDone={() => { window.location.reload(); }} />;
  }

  if (phase === 'error') {
    return (
      <div className="gate">
        <div className="gate-card card">
          <div className="brand">
            <div className="brand-mark">✈</div>
            <h1>Wander</h1>
          </div>
          <p className="small" style={{ marginTop: 0 }}>Could not start a guest session.</p>
          <p className="err" style={{ marginTop: 0 }}>{fatal}</p>
          <p className="small muted">
            This usually means anonymous sign-ins are off. In Supabase go to{' '}
            <strong>Authentication → Sign In / Providers</strong> and enable{' '}
            <strong>Anonymous sign-ins</strong>, then reload. If you have not run{' '}
            <code>schema.sql</code> yet, do that first.
          </p>
          <div className="chiprow">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
            <button className="btn" onClick={() => { clearConfig(); window.location.reload(); }}>
              Change Supabase project
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = !!(trip && user && trip.owner_id === user.id);
  const shareUrl = trip && trip.share_code && typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?join=${trip.share_code}`
    : '';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">✈</div>
        <select className="trip-pick" value={tripId || ''} aria-label="Select trip"
          onChange={(e) => {
            if (e.target.value === '__new') { setTripDraft({ currency: 'SGD', start_date: todayISO(), end_date: addDays(todayISO(), 4) }); return; }
            setTripId(e.target.value || null);
          }}>
          {trips.length === 0 ? <option value="">No trips yet</option> : null}
          {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="__new">+ New trip…</option>
        </select>
        <div className="grow" />
        {online.length > 0 ? (
          <span className="live" title={online.map((o) => o.name).join(', ')}>
            <span className="pulse" /> {online.length} here
          </span>
        ) : null}
        <div className="avatars">
          {online.slice(0, 4).map((o) => (
            <span key={o.id} className="avatar" title={o.name}
              style={{ background: colorFor(o.name) }}>{initials(o.name)}</span>
          ))}
        </div>
        <button className="btn ghost sm" title="Switch light / dark" aria-label="Switch light or dark theme"
          onClick={() => applyTheme(effectiveDark() ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : theme === 'light' ? '☾' : '◐'}
        </button>
        <button className="btn ghost sm" title="You" onClick={() => setTab('people')}>
          {displayName || 'Guest'}
        </button>
      </header>

      <div className="body">
        <nav className="rail">
          {TABS.map((t) => (
            <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
              <span className="ico" aria-hidden="true">{t.icon}</span>{t.label}
            </button>
          ))}
          <div className="rail-spacer" />
          <button onClick={() => setTripDraft({ currency: 'SGD', start_date: todayISO(), end_date: addDays(todayISO(), 4) })}>
            <span className="ico" aria-hidden="true">+</span>New trip
          </button>
          {trip ? (
            <button onClick={() => setTripDraft({ ...trip })}>
              <span className="ico" aria-hidden="true">⚙</span>Trip settings
            </button>
          ) : null}
        </nav>

        <main className="main">
          <div className="wrap">
            {toast ? (
              <div className="card" style={{ marginBottom: 14, borderColor: 'var(--danger)' }}>
                <div className="spread">
                  <span className="small">{toast}</span>
                  <button className="btn ghost sm" onClick={() => setToast('')}>Dismiss</button>
                </div>
              </div>
            ) : null}

            {!trip ? (
              <div className="empty">
                <p style={{ marginTop: 0 }}>No trip yet.</p>
                <button className="btn primary"
                  onClick={() => setTripDraft({ currency: 'SGD', start_date: todayISO(), end_date: addDays(todayISO(), 4) })}>
                  Create your first trip
                </button>
                <p className="small dim" style={{ marginBottom: 0, marginTop: 14 }}>
                  Got a share link from someone? Open it and you will land straight in their trip.
                </p>
              </div>
            ) : (
              <>
                {tab === 'itinerary' ? (
                  <Itinerary trip={trip} days={days} activities={activities}
                    onAdd={(day) => setEditing({ day, category: 'sightseeing', cost: 0 })}
                    onEdit={(a) => setEditing({ ...a })}
                    onMove={moveActivity}
                    onEditTrip={() => setTripDraft({ ...trip })} />
                ) : null}
                {tab === 'map' ? (
                  <MapView trip={trip} days={days} activities={activities}
                    onEdit={(a) => setEditing({ ...a })} />
                ) : null}
                {tab === 'budget' ? (
                  <Budget trip={trip} days={days} activities={activities} />
                ) : null}
                {tab === 'packing' ? (
                  <Packing items={packing} onAdd={addPacking} onUpdate={updatePacking} onDelete={deletePacking} />
                ) : null}
                {tab === 'notes' ? (
                  <Notes trip={trip} activities={activities} onSave={saveNotes} />
                ) : null}
                {tab === 'people' ? (
                  <People members={members} online={online} user={user} isOwner={isOwner}
                    displayName={displayName} onRename={saveDisplayName}
                    shareUrl={shareUrl} onRemove={removeMember}
                    onDeleteTrip={() => deleteTrip(trip.id)}
                    onLeaveTrip={() => leaveTrip(trip.id)} />
                ) : null}
              </>
            )}
          </div>
        </main>
      </div>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            <span className="ico" aria-hidden="true">{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>

      {editing ? (
        <ActivityModal draft={editing} days={days} currency={trip ? trip.currency : 'SGD'}
          onChange={setEditing} onSave={saveActivity} onDelete={deleteActivity}
          onClose={() => setEditing(null)} />
      ) : null}

      {tripDraft ? (
        <TripModal draft={tripDraft} onChange={setTripDraft} onSave={saveTrip}
          onClose={() => setTripDraft(null)} />
      ) : null}
    </div>
  );
}
