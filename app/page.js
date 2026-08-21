'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getClient, readConfig, missingEnv, configWarning } from '@/lib/supabase';
import {
  colorFor, dayRange, initials, sortActs, todayISO, addDays,
  ensureLocalName, writeLocalName, humanError, parseQuickAdd, nextSortOrder, fmtRange,
} from '@/lib/util';
import Itinerary from '@/components/Itinerary';
import ActivityModal from '@/components/ActivityModal';
import MapView from '@/components/MapView';
import Budget from '@/components/Budget';
import Packing from '@/components/Packing';
import Notes from '@/components/Notes';
import People from '@/components/People';
import TripModal from '@/components/TripModal';
import PrintView from '@/components/PrintView';
import Toasts from '@/components/Toasts';

const TABS = [
  { id: 'itinerary', label: 'Itinerary', icon: '\u{1F5D3}' },
  { id: 'map',       label: 'Map',       icon: '\u{1F4CD}' },
  { id: 'budget',    label: 'Budget',    icon: '\u{1F4B0}' },
  { id: 'packing',   label: 'Packing',   icon: '\u{1F392}' },
  { id: 'notes',     label: 'Notes',     icon: '\u{1F4DD}' },
  { id: 'people',    label: 'People',    icon: '\u{1F465}' },
];

const isTab = (t) => TABS.some((x) => x.id === t);

function nameOf(session, fallback) {
  if (!session || !session.user) return fallback;
  const meta = session.user.user_metadata || {};
  return meta.display_name || fallback;
}

function newTripDraft() {
  return { currency: 'SGD', start_date: todayISO(), end_date: addDays(todayISO(), 4) };
}

export default function Page() {
  const [phase, setPhase] = useState('boot'); // boot | error | app
  const [supabase, setSupabase] = useState(null);
  const [session, setSession] = useState(null);
  const [fatal, setFatal] = useState('');
  const [fatalKind, setFatalKind] = useState('session'); // config | session

  const [displayName, setDisplayName] = useState('');
  const [trips, setTrips] = useState([]);
  const [tripId, setTripId] = useState(null);
  const [activities, setActivities] = useState([]);
  const [packing, setPacking] = useState([]);
  const [members, setMembers] = useState([]);
  const [dataTripId, setDataTripId] = useState(null); // whose data is in state
  const [online, setOnline] = useState([]);
  const [tab, setTab] = useState('itinerary');
  const [editing, setEditing] = useState(null);
  const [tripDraft, setTripDraft] = useState(null);
  const [theme, setTheme] = useState('system');
  const [toasts, setToasts] = useState([]);

  const trip = useMemo(() => trips.find((t) => t.id === tripId) || null, [trips, tripId]);
  const days = useMemo(() => (trip ? dayRange(trip.start_date, trip.end_date) : []), [trip]);
  const user = session ? session.user : null;
  const dataReady = dataTripId === tripId;

  /* ----------------------------------------------------------- toasts --- */
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((message, opts) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, ...(opts || {}) }].slice(-3));
  }, []);

  const fail = useCallback((err) => {
    pushToast(humanError(err), { kind: 'error' });
  }, [pushToast]);

  /* --------------------------------------------- boot + guest session --- */
  useEffect(() => {
    try {
      const saved = localStorage.getItem('tp.theme');
      if (saved) setTheme(saved);
    } catch (e) { /* ignore */ }

    if (!readConfig()) { setFatalKind('config'); setPhase('error'); return undefined; }
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
        setFatalKind('session');
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
    if (error) { fail(error); return []; }
    setTrips(data || []);
    setTripId((cur) => (cur && (data || []).some((t) => t.id === cur) ? cur : (data && data[0] ? data[0].id : null)));
    return data || [];
  }, [supabase, fail]);

  // Guards against an older trip's rows landing after you have switched away.
  const loadToken = useRef(0);

  const loadTripData = useCallback(async (id) => {
    const token = loadToken.current + 1;
    loadToken.current = token;
    if (!supabase || !id) {
      setActivities([]); setPacking([]); setMembers([]); setDataTripId(id || null);
      return;
    }
    const [a, p, m] = await Promise.all([
      supabase.from('activities').select('*').eq('trip_id', id),
      supabase.from('packing_items').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('trip_members').select('*').eq('trip_id', id),
    ]);
    if (token !== loadToken.current) return; // superseded
    if (!a.error) setActivities((a.data || []).slice().sort(sortActs));
    if (!p.error) setPacking(p.data || []);
    if (!m.error) setMembers(m.data || []);
    setDataTripId(id);
  }, [supabase]);

  const loadRef = useRef({ loadTrips, loadTripData });
  loadRef.current = { loadTrips, loadTripData };

  /* ------------------------------ first load, share links and URL state -- */
  const urlReady = useRef(false);

  useEffect(() => {
    if (phase !== 'app' || !supabase) return;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      let joined = null;
      try {
        const code = params.get('join');
        if (code) {
          const { data, error } = await supabase.rpc('join_trip_by_code', { p_code: code });
          if (error) fail(error);
          else { joined = data; pushToast('You are in — this trip is now on your list.'); }
        }
      } catch (e) { /* ignore */ }

      const list = await loadTrips();
      const wantTab = params.get('tab');
      const wantTrip = params.get('trip');
      const nextTab = isTab(wantTab) ? wantTab : 'itinerary';
      const nextTrip = joined
        || (wantTrip && list.some((t) => t.id === wantTrip) ? wantTrip : (list[0] ? list[0].id : null));

      setTab(nextTab);
      setTripId(nextTrip);

      // Stamp a canonical URL (and drop the join code) so Back has somewhere to go.
      const p = new URLSearchParams();
      if (nextTrip) p.set('trip', nextTrip);
      p.set('tab', nextTab);
      window.history.replaceState({}, '', `${window.location.pathname}?${p.toString()}`);
      urlReady.current = true;
    })();
  }, [phase, supabase, loadTrips, fail, pushToast]);

  // state -> URL
  useEffect(() => {
    if (!urlReady.current) return;
    const params = new URLSearchParams(window.location.search);
    if ((params.get('trip') || '') === (tripId || '') && params.get('tab') === tab) return;
    const p = new URLSearchParams();
    if (tripId) p.set('trip', tripId);
    p.set('tab', tab);
    // Boot already stamped the canonical URL, so anything reaching here is a
    // real navigation and deserves its own history entry.
    window.history.pushState({}, '', `${window.location.pathname}?${p.toString()}`);
  }, [tripId, tab]);

  // URL -> state (back / forward)
  useEffect(() => {
    function onPop() {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('tab');
      setTab(isTab(t) ? t : 'itinerary');
      const tr = params.get('trip');
      if (tr) setTripId(tr);
    }
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => { loadTripData(tripId); }, [tripId, loadTripData]);

  /* --------------------------------------------------------- realtime --- */
  useEffect(() => {
    if (!supabase || !tripId || !user) return undefined;
    const filter = `trip_id=eq.${tripId}`;
    const ch = supabase.channel(`trip-${tripId}`, { config: { presence: { key: user.id } } });

    // Our own writes already updated state optimistically; coalesce the echo
    // plus any collaborator burst into one refetch.
    let timer = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current.loadTripData(tripId); }, 250);
    };

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

    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); setOnline([]); };
  }, [supabase, tripId, user, displayName]);

  /* -------------------------------------------------------- mutations --- */
  async function saveDisplayName(name) {
    const clean = (name || '').trim().slice(0, 40) || 'Guest';
    writeLocalName(clean);
    setDisplayName(clean);
    if (!supabase || !user) return;
    await supabase.auth.updateUser({ data: { display_name: clean } });
    await supabase.from('trip_members').update({ display_name: clean }).eq('user_id', user.id);
    setMembers((prev) => prev.map((m) => (m.user_id === user.id ? { ...m, display_name: clean } : m)));
  }

  async function saveTrip(draft) {
    if (!supabase || !user) return;
    const start = draft.start_date || todayISO();
    const end = draft.end_date && draft.end_date >= start ? draft.end_date : start;
    const payload = {
      name: (draft.name || '').trim() || 'Untitled trip',
      destination: draft.destination || '',
      start_date: start,
      end_date: end,
      currency: draft.currency || 'SGD',
      budget: draft.budget === '' || draft.budget === null || draft.budget === undefined ? null : Number(draft.budget),
      updated_at: new Date().toISOString(),
    };
    if (draft.id) {
      setTrips((prev) => prev.map((t) => (t.id === draft.id ? { ...t, ...payload } : t)));
      setTripDraft(null);
      const { error } = await supabase.from('trips').update(payload).eq('id', draft.id);
      if (error) { fail(error); loadTrips(); return; }
      pushToast('Trip updated.');
    } else {
      const { data, error } = await supabase.from('trips')
        .insert({ ...payload, owner_id: user.id }).select().single();
      if (error) { fail(error); return; }
      setTripDraft(null);
      await loadTrips();
      if (data) { setTripId(data.id); setTab('itinerary'); }
    }
  }

  async function deleteTrip(id) {
    if (!supabase) return;
    const { error } = await supabase.from('trips').delete().eq('id', id);
    if (error) { fail(error); return; }
    setTripId(null);
    await loadTrips();
    pushToast('Trip deleted.');
  }

  async function leaveTrip(id) {
    if (!supabase || !user) return;
    const { error } = await supabase.from('trip_members').delete().eq('trip_id', id).eq('user_id', user.id);
    if (error) { fail(error); return; }
    setTripId(null);
    await loadTrips();
    pushToast('You have left the trip.');
  }

  function activityPayload(draft) {
    return {
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
      updated_at: new Date().toISOString(),
    };
  }

  async function saveActivity(draft) {
    if (!supabase || !tripId) return;
    const payload = activityPayload(draft);
    setEditing(null);
    if (draft.id) {
      setActivities((prev) => prev.map((a) => (a.id === draft.id ? { ...a, ...payload } : a)).sort(sortActs));
      const { error } = await supabase.from('activities').update(payload).eq('id', draft.id);
      if (error) { fail(error); loadTripData(tripId); }
    } else {
      payload.sort_order = nextSortOrder(activities, payload.day);
      const { data, error } = await supabase.from('activities').insert(payload).select().single();
      if (error) { fail(error); return; }
      if (data) setActivities((prev) => [...prev, data].sort(sortActs));
    }
  }

  // "9am Senso-ji" -> a timed activity, without opening the modal at all.
  async function quickAddActivity(day, text) {
    if (!supabase || !tripId) return;
    const { title, start_time } = parseQuickAdd(text);
    const payload = {
      trip_id: tripId,
      day,
      title: title || 'Untitled',
      start_time,
      category: 'sightseeing',
      cost: 0,
      sort_order: nextSortOrder(activities, day),
    };
    const { data, error } = await supabase.from('activities').insert(payload).select().single();
    if (error) { fail(error); return; }
    if (data) setActivities((prev) => [...prev, data].sort(sortActs));
  }

  async function moveActivity(act, day) {
    if (!supabase || !day || day === act.day) return;
    const patch = {
      day,
      sort_order: nextSortOrder(activities, day),
      updated_at: new Date().toISOString(),
    };
    setActivities((prev) => prev.map((a) => (a.id === act.id ? { ...a, ...patch } : a)).sort(sortActs));
    const { error } = await supabase.from('activities').update(patch).eq('id', act.id);
    if (error) { fail(error); loadTripData(tripId); }
  }

  async function duplicateActivity(act) {
    if (!supabase) return;
    const { id, created_at: _c, updated_at: _u, ...rest } = act;
    const { data, error } = await supabase.from('activities')
      .insert({ ...rest, sort_order: nextSortOrder(activities, act.day) }).select().single();
    if (error) { fail(error); return; }
    if (data) {
      setActivities((prev) => [...prev, data].sort(sortActs));
      setEditing({ ...data }); // open the copy so you can move or retime it
    }
  }

  async function deleteActivity(act) {
    if (!supabase || !act || !act.id) return;
    const snapshot = { ...act };
    setEditing(null);
    setActivities((prev) => prev.filter((a) => a.id !== act.id));
    const { error } = await supabase.from('activities').delete().eq('id', act.id);
    if (error) { fail(error); loadTripData(tripId); return; }
    pushToast(`Deleted "${snapshot.title}".`, {
      action: {
        label: 'Undo',
        run: async () => {
          const { created_at: _c, updated_at: _u, ...row } = snapshot;
          const { data, error: err2 } = await supabase.from('activities').insert(row).select().single();
          if (err2) fail(err2);
          else if (data) setActivities((prev) => [...prev, data].sort(sortActs));
        },
      },
    });
  }

  async function addPacking(item) {
    if (!supabase || !tripId) return;
    const { data, error } = await supabase.from('packing_items')
      .insert({ trip_id: tripId, ...item }).select().single();
    if (error) { fail(error); return; }
    if (data) setPacking((prev) => [...prev, data]);
  }

  async function updatePacking(id, patch) {
    if (!supabase) return;
    const before = packing.find((p) => p.id === id);
    setPacking((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    const { error } = await supabase.from('packing_items').update(patch).eq('id', id);
    if (error) {
      fail(error);
      if (before) setPacking((prev) => prev.map((p) => (p.id === id ? before : p)));
    }
  }

  async function deletePacking(id) {
    if (!supabase) return;
    const snapshot = packing.find((p) => p.id === id);
    setPacking((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from('packing_items').delete().eq('id', id);
    if (error) { fail(error); loadTripData(tripId); return; }
    if (!snapshot) return;
    pushToast(`Removed "${snapshot.label}".`, {
      action: {
        label: 'Undo',
        run: async () => {
          const { created_at: _c, ...row } = snapshot;
          const { data, error: err2 } = await supabase.from('packing_items').insert(row).select().single();
          if (err2) fail(err2);
          else if (data) setPacking((prev) => [...prev, data]);
        },
      },
    });
  }

  async function saveNotes(text) {
    if (!supabase || !tripId) return;
    setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, notes: text } : t)));
    const { error } = await supabase.from('trips')
      .update({ notes: text, updated_at: new Date().toISOString() }).eq('id', tripId);
    if (error) fail(error);
  }

  async function removeMember(uid) {
    if (!supabase || !tripId) return;
    setMembers((prev) => prev.filter((m) => m.user_id !== uid));
    const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', uid);
    if (error) { fail(error); loadTripData(tripId); }
  }

  function openNewTrip() { setTripDraft(newTripDraft()); }
  function printTrip() { window.print(); }

  /* ----------------------------------------------------------- render --- */
  if (phase === 'boot') {
    return <div className="gate"><div className="muted">Loading…</div></div>;
  }

  if (phase === 'error') {
    const missing = missingEnv();
    const warning = configWarning();
    const cfg = readConfig();
    const apiUrl = cfg ? cfg.url : '';
    // "Failed to fetch" means nothing answered at that URL — a different
    // problem from the API answering and refusing the sign-in.
    const unreachable = /failed to fetch|networkerror|load failed|fetch failed/i.test(fatal);
    return (
      <div className="gate">
        <div className="gate-card card">
          <div className="brand">
            <div className="brand-mark">✈</div>
            <h1>Wander</h1>
          </div>
          {fatalKind === 'config' ? (
            <>
              <p className="small" style={{ marginTop: 0 }}>This app is not configured yet.</p>
              <p className="err" style={{ marginTop: 0 }}>
                {missing.length === 1
                  ? `Missing ${missing[0]}.`
                  : `Missing ${missing.join(' and ')}.`}
              </p>
              <p className="small muted">
                Set {missing.length > 1 ? 'them' : 'it'} in <code>.env.local</code> when running
                locally, or in your host&apos;s environment variables when deployed, then restart
                the server.
              </p>
              <p className="small muted">
                The URL is the Supabase <strong>API</strong> endpoint — <code>http://…</code>, not
                a <code>postgres://</code> connection string. Running{' '}
                <code>npx supabase start</code> prints both values.
              </p>
            </>
          ) : (
            <>
              <p className="small" style={{ marginTop: 0 }}>Could not start a guest session.</p>
              <p className="err" style={{ marginTop: 0 }}>{fatal}</p>
              {warning ? <p className="err" style={{ marginTop: 0 }}>{warning}</p> : null}
              {unreachable ? (
                <p className="small muted">
                  Nothing answered at <code>{apiUrl}</code>. Start the Supabase stack with{' '}
                  <code>npx supabase start</code>, or point{' '}
                  <code>NEXT_PUBLIC_SUPABASE_URL</code> at a hosted project — then restart the
                  dev server.
                </p>
              ) : (
                <p className="small muted">
                  This usually means anonymous sign-ins are off. In Supabase go to{' '}
                  <strong>Authentication → Sign In / Providers</strong> and enable{' '}
                  <strong>Anonymous sign-ins</strong>, then reload. If you have not run{' '}
                  <code>schema.sql</code> against the database yet, do that first.
                </p>
              )}
            </>
          )}
          <div className="chiprow">
            <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    );
  }

  const isOwner = !!(trip && user && trip.owner_id === user.id);
  const shareUrl = trip && trip.share_code && typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}?join=${trip.share_code}`
    : '';

  const today = todayISO();
  const buckets = { current: [], upcoming: [], undated: [], past: [] };
  trips.forEach((t) => {
    if (!t.start_date) { buckets.undated.push(t); return; }
    const end = t.end_date && t.end_date >= t.start_date ? t.end_date : t.start_date;
    if (end < today) buckets.past.push(t);
    else buckets.upcoming.push(t);
  });
  buckets.upcoming.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  buckets.past.sort((a, b) => (a.start_date > b.start_date ? -1 : 1));
  const tripOption = (t) => (
    <option key={t.id} value={t.id}>{t.name} — {fmtRange(t.start_date, t.end_date)}</option>
  );

  return (
    <>
      <div className="shell">
        <header className="topbar">
          <div className="brand-mark" aria-hidden="true">✈</div>
          <select className="trip-pick" value={tripId || ''} aria-label="Select trip"
            onChange={(e) => {
              if (e.target.value === '__new') { openNewTrip(); return; }
              setTripId(e.target.value || null);
            }}>
            {trips.length === 0 ? <option value="">No trips yet</option> : null}
            {buckets.upcoming.length ? (
              <optgroup label="Upcoming & current">{buckets.upcoming.map(tripOption)}</optgroup>
            ) : null}
            {buckets.undated.length ? (
              <optgroup label="No dates">
                {buckets.undated.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </optgroup>
            ) : null}
            {buckets.past.length ? (
              <optgroup label="Past">{buckets.past.map(tripOption)}</optgroup>
            ) : null}
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
            {trip ? (
              <button onClick={printTrip}>
                <span className="ico" aria-hidden="true">⎙</span>Print / PDF
              </button>
            ) : null}
            <button onClick={openNewTrip}>
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
              {!trip ? (
                <div className="empty">
                  <p style={{ marginTop: 0 }}>No trip yet.</p>
                  <button className="btn primary" onClick={openNewTrip}>Create your first trip</button>
                  <p className="small dim" style={{ marginBottom: 0, marginTop: 14 }}>
                    Got a share link from someone? Open it and you will land straight in their trip.
                  </p>
                </div>
              ) : !dataReady ? (
                <div aria-busy="true" aria-label="Loading trip">
                  <div className="skel skel-head" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                </div>
              ) : (
                <>
                  {tab === 'itinerary' ? (
                    <Itinerary trip={trip} days={days} activities={activities}
                      onAdd={(day, title) => setEditing({ day, title: title || '', category: 'sightseeing', cost: 0 })}
                      onEdit={(a) => setEditing({ ...a })}
                      onQuickAdd={quickAddActivity}
                      onMove={moveActivity}
                      onDuplicate={duplicateActivity}
                      onDelete={deleteActivity}
                      onPrint={printTrip}
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

        <Toasts items={toasts} onDismiss={dismissToast} />
      </div>

      <PrintView trip={trip} days={days} activities={activities}
        packing={packing} members={members} />
    </>
  );
}
