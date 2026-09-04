'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useApp } from '@/components/AppProvider';
import { dayRange, sortActs, parseQuickAdd, nextSortOrder } from '@/lib/util';
import { createSerialQueue } from '@/lib/asyncWork';
import { mergeAgentHistory } from '@/lib/agentHistory';
import { lodgingPayload, moveStay } from '@/lib/lodging';

const Ctx = createContext(null);

export function useTrip() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTrip must be used inside <TripProvider>');
  return ctx;
}

/**
 * Everything scoped to one trip: its row, activities, packing, members,
 * presence and the mutations over them. Writes apply optimistically and roll
 * back on error; realtime echoes are coalesced into a single refetch.
 */
export default function TripProvider({ tripId, children }) {
  const { supabase, user, displayName, pushToast, fail } = useApp();

  const [trip, setTrip] = useState(null);
  const [activities, setActivities] = useState([]);
  const [packing, setPacking] = useState([]);
  const [members, setMembers] = useState([]);
  const [agentHistory, setAgentHistory] = useState([]);
  const historyQueue = useRef(null);
  if (!historyQueue.current) historyQueue.current = createSerialQueue();
  const pendingHistory = useRef(new Map());
  const historyScope = useRef(null);
  historyScope.current = `${tripId}:${user?.id || ''}`;
  const [online, setOnline] = useState([]);
  const [loadedId, setLoadedId] = useState(null);
  const [notFound, setNotFound] = useState(false);
  /*
   * "Take me to this activity", held here rather than in the address.
   *
   * It used to travel as ?focus=, which read well but could not be taken back
   * out: removing it is a navigation, a navigation remounts the page, and the
   * remount closed the editor the request had just opened. Asking for the same
   * activity twice was also silent, because the address did not change the
   * second time. A timestamp makes every request distinct, and clearing it
   * costs nothing.
   */
  const [focusReq, setFocusReq] = useState(null);
  /*
   * "Start a new one of these", asked for from somewhere that cannot open it.
   * The command bar lives in the chrome; the editors it wants to open belong
   * to the page underneath. Same shape as focusReq, and for the same reason:
   * a timestamp makes every request distinct, so asking twice works twice.
   */
  const [intent, setIntent] = useState(null); // { kind, seed, at }

  const ready = loadedId === tripId;
  const days = useMemo(() => (trip ? dayRange(trip.start_date, trip.end_date) : []), [trip]);
  const isOwner = !!(trip && user && trip.owner_id === user.id);

  // Guards against an older trip's rows landing after a switch.
  const token = useRef(0);

  const load = useCallback(async (id) => {
    if (!supabase || !id) return;
    const mine = token.current + 1;
    token.current = mine;
    const [t, a, p, m, h] = await Promise.all([
      supabase.from('trips').select('*').eq('id', id).maybeSingle(),
      supabase.from('activities').select('*').eq('trip_id', id),
      supabase.from('packing_items').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('trip_members').select('*').eq('trip_id', id),
      supabase.from('trip_agent_messages').select('*').eq('trip_id', id)
        .order('created_at', { ascending: false }).limit(60),
    ]);
    if (mine !== token.current) return; // superseded
    if (t.error) { fail(t.error); return; }
    if (!t.data) { setNotFound(true); setLoadedId(id); return; }
    setNotFound(false);
    setTrip(t.data);
    if (!a.error) setActivities((a.data || []).slice().sort(sortActs));
    if (!p.error) setPacking(p.data || []);
    if (!m.error) setMembers(m.data || []);
    if (!h.error) setAgentHistory((prev) => mergeAgentHistory(h.data || [], [
      ...prev.filter((row) => row.trip_id === id),
      ...[...pendingHistory.current.values()].filter((row) => row.trip_id === id && row.user_id === user?.id),
    ]));
    setLoadedId(id);
  }, [supabase, fail, user?.id]);

  useEffect(() => { load(tripId); }, [tripId, load]);

  /* --------------------------------------------------------- realtime --- */
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!supabase || !tripId || !user) return undefined;
    const filter = `trip_id=eq.${tripId}`;
    const ch = supabase.channel(`trip-${tripId}`, { config: { presence: { key: user.id } } });

    let timer = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { loadRef.current(tripId); }, 250);
    };

    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'activities', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_items', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_agent_messages', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${tripId}` }, refresh)
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

  /* -------------------------------------------------------- activities --- */
  function activityPayload(draft) {
    return {
      trip_id: tripId,
      day: draft.day,
      start_time: draft.start_time || null,
      end_time: draft.end_time || null,
      title: (draft.title || '').trim() || 'Untitled',
      category: draft.category || 'sightseeing',
      location: draft.location || '',
      lat: draft.lat === '' || draft.lat == null ? null : Number(draft.lat),
      lng: draft.lng === '' || draft.lng == null ? null : Number(draft.lng),
      cost: Number(draft.cost || 0),
      // The editor can pin a place too, and used to drop what it learned on
      // the way to the database — so an activity located by hand kept its
      // coordinates and lost the identity behind them.
      place_id: draft.place_id || null,
      photo_ref: draft.photo_ref || null,
      booking_ref: draft.booking_ref || '',
      notes: draft.notes || '',
      /*
       * Only transport has a mode, and only a mode has fields. Anything else
       * carrying a subtype would be a leftover from a category change, so both
       * are cleared rather than kept where they mean nothing.
       */
      subtype: draft.category === 'transport' ? draft.subtype || null : null,
      details: draft.category === 'transport' && draft.details ? draft.details : {},
      ...lodgingPayload(draft),
      updated_at: new Date().toISOString(),
    };
  }

  const saveActivity = useCallback(async (draft) => {
    if (!supabase || !tripId) return;
    const payload = activityPayload(draft);
    if (draft.id) {
      setActivities((prev) => prev.map((a) => (a.id === draft.id ? { ...a, ...payload } : a)).sort(sortActs));
      const { error } = await supabase.from('activities').update(payload).eq('id', draft.id);
      if (error) { fail(error); load(tripId); }
    } else {
      payload.sort_order = nextSortOrder(activities, payload.day);
      const { data, error } = await supabase.from('activities').insert(payload).select().single();
      if (error) { fail(error); return; }
      if (data) setActivities((prev) => [...prev, data].sort(sortActs));
    }
  }, [supabase, tripId, activities, fail, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const quickAddActivity = useCallback(async (day, text) => {
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
  }, [supabase, tripId, activities, fail]);

  const moveActivity = useCallback(async (act, day) => {
    if (!supabase || !day || day === act.day) return;
    const patch = { day, ...moveStay(act, day), sort_order: nextSortOrder(activities, day), updated_at: new Date().toISOString() };
    setActivities((prev) => prev.map((a) => (a.id === act.id ? { ...a, ...patch } : a)).sort(sortActs));
    const { error } = await supabase.from('activities').update(patch).eq('id', act.id);
    if (error) { fail(error); load(tripId); }
  }, [supabase, tripId, activities, fail, load]);

  const duplicateActivity = useCallback(async (act) => {
    if (!supabase) return null;
    const { id, created_at: _c, updated_at: _u, ...rest } = act;
    const { data, error } = await supabase.from('activities')
      .insert({ ...rest, sort_order: nextSortOrder(activities, act.day) }).select().single();
    if (error) { fail(error); return null; }
    if (data) setActivities((prev) => [...prev, data].sort(sortActs));
    return data;
  }, [supabase, activities, fail]);

  /** Fills in what the place lookup returned, without touching anything else. */
  const setActivityCoords = useCallback(async (id, lat, lng, location, placeId, photoRef) => {
    if (!supabase || !id) return;
    const patch = { lat, lng, updated_at: new Date().toISOString() };
    if (location) patch.location = location;
    if (placeId) patch.place_id = placeId;
    if (photoRef) patch.photo_ref = photoRef;
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    const { error } = await supabase.from('activities').update(patch).eq('id', id);
    if (error) fail(error);
  }, [supabase, fail]);

  /** Adds a stop straight from the map, already located. */
  const addLocatedActivity = useCallback(async (draft) => {
    if (!supabase || !tripId) return null;
    const payload = {
      trip_id: tripId,
      day: draft.day,
      title: (draft.title || '').trim() || 'Untitled',
      category: draft.category || 'sightseeing',
      location: draft.location || '',
      lat: Number(draft.lat),
      lng: Number(draft.lng),
      cost: 0,
      sort_order: nextSortOrder(activities, draft.day),
    };
    const { data, error } = await supabase.from('activities').insert(payload).select().single();
    if (error) { fail(error); return null; }
    if (data) {
      setActivities((prev) => [...prev, data].sort(sortActs));
      pushToast(`Added "${data.title}".`);
    }
    return data;
  }, [supabase, tripId, activities, fail, pushToast]);

  /** Bulk insert, for anything that produces several rows at once. */
  /** Returns the rows it created, so a caller can point at what it just made. */
  const addActivities = useCallback(async (drafts) => {
    if (!supabase || !tripId || !drafts.length) return [];
    const rows = [];
    drafts.forEach((d) => {
      rows.push({
        trip_id: tripId,
        day: d.day,
        title: (d.title || '').trim() || 'Untitled',
        start_time: d.start_time || null,
        end_time: d.end_time || null,
        category: d.category || 'sightseeing',
        location: d.location || '',
        lat: d.lat === '' || d.lat == null ? null : Number(d.lat),
        lng: d.lng === '' || d.lng == null ? null : Number(d.lng),
        cost: Number(d.cost || 0),
        subtype: d.category === 'transport' ? d.subtype || null : null,
        details: d.category === 'transport' && d.details ? d.details : {},
        ...lodgingPayload(d),
        booking_ref: d.booking_ref || '',
        notes: d.notes || '',
        place_id: d.place_id || null,
        photo_ref: d.photo_ref || null,
        sort_order: nextSortOrder([...activities, ...rows], d.day),
      });
    });
    const { data, error } = await supabase.from('activities').insert(rows).select();
    if (error) { fail(error); return []; }
    if (data) setActivities((prev) => [...prev, ...data].sort(sortActs));
    return data || [];
  }, [supabase, tripId, activities, fail]);

  const addPackingItems = useCallback(async (items) => {
    if (!supabase || !tripId || !items.length) return 0;
    const rows = items.map((i) => ({
      trip_id: tripId,
      label: i.label,
      category: i.category || 'general',
      qty: Number(i.qty) || 1,
    }));
    const { data, error } = await supabase.from('packing_items').insert(rows).select();
    if (error) { fail(error); return 0; }
    if (data) setPacking((prev) => [...prev, ...data]);
    return data ? data.length : 0;
  }, [supabase, tripId, fail]);

  /* Messages are append-only. That keeps later requests tied to what was
     actually said at the time, including questions the agent asked. */
  const appendAgentMessage = useCallback(({ role, kind, content, meta = {} }) => {
    if (!supabase || !tripId || !user || !content) return Promise.resolve(null);
    const scope = `${tripId}:${user.id}`;
    const row = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      trip_id: tripId,
      user_id: user.id,
      role: role === 'assistant' ? 'assistant' : 'user',
      kind: kind || 'message',
      content: String(content).slice(0, 4000),
      meta,
    };
    // Keep follow-ups aware of messages immediately, even while the database
    // is slow. Realtime refreshes must not erase entries still being saved.
    pendingHistory.current.set(row.id, row);
    setAgentHistory((prev) => mergeAgentHistory(prev, [row]));
    return historyQueue.current(async () => {
      try {
        const { data, error } = await supabase.from('trip_agent_messages').insert(row).select().single();
        if (error) throw error;
        pendingHistory.current.delete(row.id);
        if (data && historyScope.current === scope) setAgentHistory((prev) =>
          mergeAgentHistory(prev.filter((message) => message.id !== data.id), [data]));
        return data || null;
      } catch (error) {
        console.error('[agent history] message save failed');
        if (historyScope.current === scope) pushToast('This conversation entry could not be saved. It is still available in this session.');
        return null;
      }
    });
  }, [supabase, tripId, user, pushToast]);

  const deleteActivity = useCallback(async (act) => {
    if (!supabase || !act || !act.id) return;
    const snapshot = { ...act };
    setActivities((prev) => prev.filter((a) => a.id !== act.id));
    const { error } = await supabase.from('activities').delete().eq('id', act.id);
    if (error) { fail(error); load(tripId); return; }
    pushToast(`Deleted "${snapshot.title}".`, {
      action: {
        label: 'Undo',
        run: async () => {
          const { created_at: _c, updated_at: _u, ...row } = snapshot;
          const { data, error: e2 } = await supabase.from('activities').insert(row).select().single();
          if (e2) fail(e2);
          else if (data) setActivities((prev) => [...prev, data].sort(sortActs));
        },
      },
    });
  }, [supabase, tripId, fail, load, pushToast]);

  /* ----------------------------------------------------------- packing --- */
  const addPacking = useCallback(async (item) => {
    if (!supabase || !tripId) return;
    const { data, error } = await supabase.from('packing_items')
      .insert({ trip_id: tripId, ...item }).select().single();
    if (error) { fail(error); return; }
    if (data) setPacking((prev) => [...prev, data]);
  }, [supabase, tripId, fail]);

  const updatePacking = useCallback(async (id, patch) => {
    if (!supabase) return;
    let before = null;
    setPacking((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      before = p;
      return { ...p, ...patch };
    }));
    const { error } = await supabase.from('packing_items').update(patch).eq('id', id);
    if (error) {
      fail(error);
      if (before) setPacking((prev) => prev.map((p) => (p.id === id ? before : p)));
    }
  }, [supabase, fail]);

  const deletePacking = useCallback(async (id) => {
    if (!supabase) return;
    const snapshot = packing.find((p) => p.id === id);
    setPacking((prev) => prev.filter((p) => p.id !== id));
    const { error } = await supabase.from('packing_items').delete().eq('id', id);
    if (error) { fail(error); load(tripId); return; }
    if (!snapshot) return;
    pushToast(`Removed "${snapshot.label}".`, {
      action: {
        label: 'Undo',
        run: async () => {
          const { created_at: _c, ...row } = snapshot;
          const { data, error: e2 } = await supabase.from('packing_items').insert(row).select().single();
          if (e2) fail(e2);
          else if (data) setPacking((prev) => [...prev, data]);
        },
      },
    });
  }, [supabase, tripId, packing, fail, load, pushToast]);

  /* ------------------------------------------------------ trip + people --- */
  /** Trip-level fields, for the command bar and anything else that needs them. */
  const updateTrip = useCallback(async (patch) => {
    if (!supabase || !tripId) return;
    const clean = { ...patch, updated_at: new Date().toISOString() };
    setTrip((prev) => (prev ? { ...prev, ...clean } : prev));
    const { error } = await supabase.from('trips').update(clean).eq('id', tripId);
    if (error) { fail(error); load(tripId); }
  }, [supabase, tripId, fail, load]);

  const saveNotes = useCallback(async (text) => {
    if (!supabase || !tripId) return;
    setTrip((prev) => (prev ? { ...prev, notes: text } : prev));
    const { error } = await supabase.from('trips')
      .update({ notes: text, updated_at: new Date().toISOString() }).eq('id', tripId);
    if (error) fail(error);
  }, [supabase, tripId, fail]);

  const removeMember = useCallback(async (uid) => {
    if (!supabase || !tripId) return;
    setMembers((prev) => prev.filter((m) => m.user_id !== uid));
    const { error } = await supabase.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', uid);
    if (error) { fail(error); load(tripId); }
  }, [supabase, tripId, fail, load]);

  const requestFocus = useCallback((id) => {
    if (id) setFocusReq({ id: String(id), at: Date.now() });
  }, []);
  const clearFocus = useCallback(() => setFocusReq(null), []);

  const request = useCallback((kind, seed) => {
    setIntent({ kind, seed: seed || null, at: Date.now() });
  }, []);
  const clearIntent = useCallback(() => setIntent(null), []);

  const value = useMemo(() => ({
    tripId, trip, days, activities, packing, members, agentHistory, online, ready, notFound, isOwner,
    focusReq, requestFocus, clearFocus,
    intent, request, clearIntent,
    reload: () => load(tripId),
    setTrip,
    saveActivity, quickAddActivity, moveActivity, duplicateActivity, deleteActivity,
    setActivityCoords, addLocatedActivity, addActivities, addPackingItems, appendAgentMessage, updateTrip,
    addPacking, updatePacking, deletePacking, saveNotes, removeMember,
  }), [
    tripId, trip, days, activities, packing, members, agentHistory, online, ready, notFound, isOwner, load,
    focusReq, requestFocus, clearFocus,
    intent, request, clearIntent,
    saveActivity, quickAddActivity, moveActivity, duplicateActivity, deleteActivity,
    setActivityCoords, addLocatedActivity, addActivities, addPackingItems, appendAgentMessage, updateTrip,
    addPacking, updatePacking, deletePacking, saveNotes, removeMember,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
