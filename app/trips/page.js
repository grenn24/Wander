'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, CalendarDays, MapPin, Wallet, ArrowRight, UserRound, LayoutGrid, Rows3,
  MoreHorizontal, Pencil, Copy, Trash2, Users,
} from 'lucide-react';
import Popover from '@/components/Popover';
import { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import { removeDownload } from '@/public/offline-store';
import TripModal from '@/components/TripModal';
import ConfirmModal from '@/components/ConfirmModal';
import useKept from '@/components/useKept';
import PlanPrompt from '@/components/PlanPrompt';
import PlacePhoto from '@/components/PlacePhoto';
import { COVER_BUCKET, coverPathFor, coverURL } from '@/lib/tripCover';
import TravelArt from '@/components/TravelArt';
import HomeNav from '@/components/HomeNav';
import GuideRail from '@/components/GuideRail';
import FavouriteButton from '@/components/FavouriteButton';
import {
  readFavourites, setFavourite, withFavourite, noFavourites, favouritesMissing,
} from '@/lib/favourites';
import { addDays, fmtRange, money, todayISO, tripStatus, humanError } from '@/lib/util';
import { readWithSessionRecovery } from '@/lib/sessionRecovery';
import { keepTripCount, readTripCount } from '@/lib/tripMemory';

const STATUS_LABEL = { current: 'Under way', upcoming: 'Upcoming', past: 'Past', undated: 'No dates' };

/*
 * Cards or rows.
 *
 * Cards are right for three trips: the destination and the dates have room to
 * be read at a glance and the grid looks like a shelf of them. They are wrong
 * for twenty, where the same information wants to be a column you can run your
 * eye down. Which one is better depends on how much you travel, so it is a
 * choice rather than a rule — remembered per browser, because it is a habit
 * rather than something about the trips.
 */
const VIEW_KEY = 'wander:trips-view';

export default function TripsHome() {
  const { supabase, user, sessionRevision, fail, pushToast } = useApp();
  const router = useRouter();
  const [trips, setTrips] = useState([]);
  const [view, setView] = useState('list'); // cards | list
  /*
   * How many trips there were last time this device looked, so the line under
   * the heading is there in the first paint rather than filling in when they
   * land. This page is only ever drawn after signing in, so there is no
   * server-rendered count to disagree with.
   */
  const [knownCount] = useState(() => (typeof window === 'undefined' ? null : readTripCount()));
  const [memberCounts, setMemberCounts] = useState({});
  /*
   * The row menu: which trip it belongs to, and what it hangs off.
   *
   * Reaching a trip's own settings meant opening the trip first, which is a
   * long way round for "rename this" or "I made this by mistake". One menu for
   * the whole list rather than one per card — twenty popovers to move a name
   * is twenty things mounted for one of them to be used.
   */
  const [menuFor, setMenuFor] = useState(null);
  const [menuEl, setMenuEl] = useState(null);
  const [confirmKill, setConfirmKill] = useState(null);
  // trip id -> who owns it, for the ones somebody else does.
  const [sharedBy, setSharedBy] = useState({});
  // Hearted trips. Without the favourites table yet, the hearts are simply not offered.
  const [favs, setFavs] = useState(noFavourites);
  const [canFavourite, setCanFavourite] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const failedLoad = useRef(false);
  const loadToken = useRef(0);
  const [draft, setDraft] = useState(null);
  // Dialogs stay on screen long enough to play their way out.
  const tripShown = useKept(draft);
  const killShown = useKept(confirmKill);

  const load = useCallback(async () => {
    if (!supabase) return;
    const mine = ++loadToken.current;
    failedLoad.current = false;
    setLoadError('');
    setLoading(true);
    try {
      /*
       * The trips, who is on each of them, and which are yours to keep, in one
       * read.
       *
       * All three used to be their own calls, and the last two landed after
       * the list was drawn: "3 travellers", "Shared by …" and a heart filling
       * in on a row the reader was already looking at. A trip's members and a
       * reader's own favourites both hang off the trip, so the one read brings
       * them. Should a server refuse the join — a database without the
       * favourites table, a policy that will not follow it — the plain read
       * and the separate calls are still there behind it.
       */
      const together = await readWithSessionRecovery(supabase, () => supabase.from('trips')
        .select('*, trip_members(display_name, email, role), favourites(id)')
        .order('start_date', { ascending: false }));
      const joined = !together.error;
      const { data, error } = joined ? together : await readWithSessionRecovery(supabase, () =>
        supabase.from('trips').select('*').order('start_date', { ascending: false }));
      if (mine !== loadToken.current) return;
      if (error) throw error;

      // The rows stay as they were: everything else in the app reads a trip, not what hangs off it.
      const rows = [];
      const counts = {};
      const by = {};
      const kept = noFavourites();
      (data || []).forEach(({ trip_members: onIt, favourites: keptByMe, ...trip }) => {
        rows.push(trip);
        if (!joined) return;
        const members = onIt || [];
        if (members.length) counts[trip.id] = members.length;
        const owner = members.find((m) => m.role === 'owner');
        if (owner && trip.owner_id !== (user && user.id)) {
          by[trip.id] = owner.display_name || (owner.email || '').split('@')[0] || 'someone else';
        }
        // Only a reader's own favourites come back, so any row at all is theirs.
        if ((keptByMe || []).length) kept.trips.add(trip.id);
      });
      setTrips(rows);
      if (joined) { setMemberCounts(counts); setSharedBy(by); setFavs(kept); }
      // For the next visit's first paint (see knownCount above).
      keepTripCount(rows.length);
      setLoading(false);

      if (!joined) {
        readFavourites(supabase).then((f) => {
          if (mine === loadToken.current) setFavs(f);
        }).catch((e) => {
          if (mine === loadToken.current && favouritesMissing(e)) setCanFavourite(false);
        });
      }

      const tripIds = rows.map((t) => t.id);
      if (!tripIds.length) {
        setMemberCounts({});
        setSharedBy({});
      }

      /*
       * Whose trips these are, where the join above was refused.
       *
       * A trip someone shared with you sits in this list looking exactly like
       * one you started, which matters most in the case where it matters most:
       * the moment before you change something in somebody else's plan.
       */
      if (joined) return;
      const theirs = new Set(
        rows.filter((t) => t.owner_id !== (user && user.id)).map((t) => t.id),
      );
      const { data: members } = await supabase.from('trip_members')
        .select('trip_id, display_name, email, role')
        .in('trip_id', tripIds);
      const late = {};
      if (mine !== loadToken.current) return;
      const tally = {};
      (members || []).forEach((m) => {
        tally[m.trip_id] = (tally[m.trip_id] || 0) + 1;
        if (m.role === 'owner' && theirs.has(m.trip_id)) {
          late[m.trip_id] = m.display_name
            || (m.email || '').split('@')[0]
            || 'someone else';
        }
      });
      setSharedBy(late);
      setMemberCounts(tally);
    } catch (error) {
      if (mine !== loadToken.current) return;
      failedLoad.current = true;
      setLoadError(humanError(error));
      setLoading(false);
    }
  }, [supabase, user?.id]);

  useEffect(() => {
    load();
    return () => { loadToken.current += 1; };
  }, [load]);
  useEffect(() => { if (failedLoad.current) load(); }, [sessionRevision, load]);

  /* Read after mount, not during render: the server has no localStorage and
     would send markup the first client render then disagreed with. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'cards') setView(saved);
    } catch (e) { /* storage off; use the default list */ }
  }, []);

  /* Heart a trip on the spot; if the database refuses, the heart goes back. */
  async function favourite(t, on) {
    if (!supabase || !user) return;
    const before = favs;
    setFavs(withFavourite(favs, { tripId: t.id }, on));
    try {
      await setFavourite(supabase, user.id, { tripId: t.id }, on);
      pushToast(on ? `${t.name} is in your favourites.` : `${t.name} is no longer a favourite.`);
    } catch (e) {
      setFavs(before);
      if (favouritesMissing(e)) setCanFavourite(false);
      fail(e);
    }
  }

  function chooseView(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) { /* nothing to remember with */ }
  }

  const groups = useMemo(() => {
    const today = todayISO();
    const out = { current: [], upcoming: [], undated: [], past: [] };
    trips.forEach((t) => out[tripStatus(t, today)].push(t));
    out.upcoming.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    out.current.sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
    return out;
  }, [trips]);

  /**
   * A copy of a trip, with its activities.
   *
   * The days move with the dates rather than being kept: a copy of last
   * March's trip is almost always next March's, and dates that have already
   * happened are the first thing anyone would have to change.
   */
  async function duplicate(t) {
    if (!supabase || !user) return;
    setMenuFor(null);
    const { data: copy, error } = await supabase.from('trips').insert({
      owner_id: user.id,
      name: `${t.name} (copy)`,
      destination: t.destination,
      start_date: t.start_date,
      end_date: t.end_date,
      currency: t.currency,
      timezone: t.timezone || null,
      budget: t.budget,
      notes: t.notes || '',
      cover_ref: t.cover_ref || null,
    }).select().single();
    if (error || !copy) { fail(error || new Error('Could not copy that trip.')); return; }

    /*
     * A cover of its own is a file, and two trips must not share one: deleting
     * one trip's cover would empty the other's. So the copy gets a copy of the
     * file, and if that will not happen it simply starts without a cover.
     */
    if (t.cover_path) {
      const path = coverPathFor(copy.id);
      const { error: copyError } = await supabase.storage.from(COVER_BUCKET).copy(t.cover_path, path);
      if (!copyError) await supabase.from('trips').update({ cover_path: path }).eq('id', copy.id);
    }

    const { data: acts } = await supabase.from('activities')
      .select('day, start_time, end_time, title, category, location, cost, notes,'
        + ' place_id, photo_ref, sort_order, subtype, details')
      .eq('trip_id', t.id);
    if (acts && acts.length) {
      const { error: actErr } = await supabase.from('activities')
        .insert(acts.map((a) => ({ ...a, trip_id: copy.id })));
      if (actErr) fail(actErr);
    }
    pushToast(`Copied to "${copy.name}".`);
    await load();
  }

  async function kill(t) {
    if (!supabase) return;
    setConfirmKill(null);
    setMenuFor(null);
    // Before the trip goes: whether its cover may be taken away is decided by
    // membership of a trip that is about to stop existing.
    if (t.cover_path) {
      try { await supabase.storage.from(COVER_BUCKET).remove([t.cover_path]); } catch { /* left behind */ }
    }
    const { error } = await supabase.from('trips').delete().eq('id', t.id);
    if (error) { fail(error); return; }
    await removeDownload(t.id).catch(() => {});
    pushToast(`"${t.name}" deleted.`);
    await load();
  }

  async function saveTrip(d) {
    if (!supabase || !user) return;
    const start = d.start_date || todayISO();
    const end = d.end_date && d.end_date >= start ? d.end_date : start;
    const payload = {
      name: (d.name || '').trim() || 'Untitled trip',
      destination: d.destination || '',
      start_date: start,
      end_date: end,
      currency: d.currency || 'SGD',
      timezone: d.timezone || null,
      budget: d.budget === '' || d.budget == null ? null : Number(d.budget),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase.from('trips')
      .insert({ ...payload, owner_id: user.id }).select().single();
    if (error) { fail(error); return; }
    setDraft(null);
    pushToast('Trip created.');
    if (data) router.push(`/trips/${data.id}/itinerary`);
  }

  const openNew = () => setDraft({
    currency: 'SGD', start_date: todayISO(), end_date: addDays(todayISO(), 4),
  });

  const ordered = [...groups.current, ...groups.upcoming, ...groups.undated, ...groups.past];

  return (
    <div className="shell">
      <TopBar><HomeNav active="trips" /></TopBar>
      <main className="main main-plain">
        <div className="wrap">
          <div className="page-head spread">
            <div>
              <h2>Your trips</h2>
              <div className="small muted trips-count">
                {/* A line of its own while the count is unknown, rather than a
                    blank that fills once the trips land: something arriving
                    under the heading after the page has settled is felt. */}
                {loading && knownCount === null ? (
                  <span className="skel" aria-hidden="true"
                    style={{ display: 'inline-block', width: 64, height: '0.85em', borderRadius: 6 }} />
                ) : (loading ? knownCount : trips.length) === 0 ? 'Nothing planned yet'
                  : `${loading ? knownCount : trips.length} trip${(loading ? knownCount : trips.length) === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="page-head-acts">
              {/* Only worth offering once there is a list to have an opinion
                  about — but drawn while they are still coming, so it is not a
                  control that appears in this row once the page has settled.
                  It sets a choice held on this device, so it works at once. */}
              {(loading ? knownCount === null || knownCount > 1 : trips.length > 1) ? (
                <div className="viewswap" role="group" aria-label="How to show your trips">
                  <button type="button" className="viewswap-b" aria-pressed={view === 'cards'}
                    data-tip="Cards" aria-label="Show trips as cards"
                    onClick={() => chooseView('cards')}>
                    <LayoutGrid size={15} />
                  </button>
                  <button type="button" className="viewswap-b" aria-pressed={view === 'list'}
                    data-tip="List" aria-label="Show trips as a list"
                    onClick={() => chooseView('list')}>
                    <Rows3 size={15} />
                  </button>
                </div>
              ) : null}
              <button className="btn primary" onClick={openNew}>
                <Plus size={16} /> New trip
              </button>
            </div>
          </div>

          <div className="trips-plan">
            <PlanPrompt compact />
          </div>

          {/* Beside the moment of starting a trip, for when there is no
              sentence to type yet. */}
          <GuideRail />

          {loadError ? (
            <div className="empty empty-lg" role="alert">
              <p className="empty-title">Could not load your trips</p>
              <p className="small muted">{loadError}</p>
              <button className="btn primary" type="button" onClick={load}>Try again</button>
            </div>
          ) : loading ? (
            <div className="tripgrid">
              <div className="skel skel-card" /><div className="skel skel-card" /><div className="skel skel-card" />
            </div>
          ) : trips.length === 0 ? (
            <div className="empty empty-lg">
              <TravelArt kind="trips" />
              <p className="empty-title">No trips yet</p>
              <p className="small muted" style={{ marginTop: 0 }}>
                Start one and Wander lays out a day for every date in the range.
              </p>
              <button className="btn primary" onClick={openNew}>
                <Plus size={16} /> Create your first trip
              </button>
              <p className="small dim" style={{ marginBottom: 0, marginTop: 16 }}>
                Got a share link from someone? Opening it drops you straight into their trip.
              </p>
            </div>
          ) : (
            <div className={view === 'list' ? 'triplist' : 'tripgrid'}>
              {ordered.map((t) => {
                const status = tripStatus(t);
                const from = sharedBy[t.id];
                const people = memberCounts[t.id] || 1;
                const cover = coverURL(t, 104);
                const shared = from ? (
                  <span className="sharedpill" data-tip={`${from} owns this trip`}>
                    <UserRound size={11} aria-hidden="true" />
                    Shared by {from}
                  </span>
                ) : null;

                /* One row per trip: the same facts, in a line, with the name
                   holding the left edge so the eye has a column to follow. */
                if (view === 'list') {
                  return (
                    <Link key={t.id} href={`/trips/${t.id}/itinerary`} className="triprow">
                      <PlacePhoto src={cover} category="other" icon={MapPin}
                        size={52} rounded={16} alt="" />
                      <span className="triprow-main">
                        <span className="triprow-name">{t.name}</span>
                        <span className="triprow-meta">
                          {t.destination ? <span><MapPin size={13} /> {t.destination}</span> : null}
                          <span><CalendarDays size={13} /> {fmtRange(t.start_date, t.end_date)}</span>
                          <span><Users size={13} /> {people} traveller{people === 1 ? '' : 's'}</span>
                          {shared}
                          {t.budget != null ? (
                            <span><Wallet size={13} /> {money(t.budget, t.currency)}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="triprow-end">
                        <span className={`statuspill is-${status}`}>{STATUS_LABEL[status]}</span>
                        {canFavourite ? (
                          <FavouriteButton compact on={favs.trips.has(t.id)} name={t.name}
                            onToggle={(on) => favourite(t, on)} />
                        ) : null}
                        <button className="tripcard-more" type="button"
                          data-tip="Edit, copy, delete"
                          aria-label={`Actions for ${t.name}`}
                          aria-expanded={menuFor === t.id}
                          onClick={(e) => {
                            e.preventDefault(); e.stopPropagation();
                            const same = menuFor === t.id;
                            setMenuEl(e.currentTarget);
                            setConfirmKill(null);
                            setMenuFor(same ? null : t.id);
                          }}>
                          <MoreHorizontal size={16} />
                        </button>
                        <ArrowRight size={16} className="tripcard-go" aria-hidden="true" />
                      </span>
                    </Link>
                  );
                }

                return (
                  <Link key={t.id} href={`/trips/${t.id}/itinerary`} className="tripcard">
                    <div className="tripcard-top">
                      <span className={`statuspill is-${status}`}>{STATUS_LABEL[status]}</span>
                      {shared}
                      <button className="tripcard-more" type="button"
                        data-tip="Edit, copy, delete"
                        aria-label={`Actions for ${t.name}`}
                        aria-expanded={menuFor === t.id}
                        onClick={(e) => {
                          e.preventDefault(); e.stopPropagation();
                          const same = menuFor === t.id;
                          setMenuEl(e.currentTarget);
                          setConfirmKill(null);
                          setMenuFor(same ? null : t.id);
                        }}>
                        <MoreHorizontal size={16} />
                      </button>
                      {canFavourite ? (
                        <FavouriteButton compact on={favs.trips.has(t.id)} name={t.name}
                          onToggle={(on) => favourite(t, on)} />
                      ) : null}
                      <ArrowRight size={16} className="tripcard-go" aria-hidden="true" />
                    </div>
                    <h3 className="tripcard-name">{t.name}</h3>
                    <div className="tripcard-meta">
                      <span><CalendarDays size={13} /> {fmtRange(t.start_date, t.end_date)}</span>
                      {t.destination ? <span><MapPin size={13} /> {t.destination}</span> : null}
                      {t.budget != null ? (
                        <span><Wallet size={13} /> {money(t.budget, t.currency)}</span>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* One menu for the list, anchored to whichever button opened it. */}
      <Popover anchorEl={menuEl} open={!!menuFor} width={196}
        onClose={() => setMenuFor(null)}>
        <div className="act-menu" role="menu">
          {(() => {
            const t = trips.find((x) => x.id === menuFor);
            if (!t) return null;
            const mine = !!user && t.owner_id === user.id;
            return (
              <>
                <button type="button" role="menuitem"
                  onClick={() => { setMenuFor(null); setDraft({ ...t }); }}>
                  <Pencil size={15} /> Edit details
                </button>
                <button type="button" role="menuitem" onClick={() => duplicate(t)}>
                  <Copy size={15} /> Duplicate
                </button>
                <Link href={`/trips/${t.id}/settings`} role="menuitem"
                  onClick={() => setMenuFor(null)}>
                  <UserRound size={15} /> Sharing &amp; people
                </Link>
                {/* Only the owner can, and the database agrees — but offering
                    it and then failing is worse than not offering it. */}
                {mine ? (
                  <>
                    <div className="menu-rule" />
                    <button type="button" role="menuitem" className="danger"
                      onClick={() => { setConfirmKill(t); setMenuFor(null); }}>
                      <Trash2 size={15} /> Delete trip
                    </button>
                  </>
                ) : null}
              </>
            );
          })()}
        </div>
      </Popover>

      {tripShown.value ? (
        <TripModal draft={tripShown.value} leaving={tripShown.leaving}
          onChange={setDraft} onSave={saveTrip} onClose={() => setDraft(null)} />
      ) : null}

      {killShown.value ? (
        <ConfirmModal title="Delete trip?" confirmLabel="Delete trip" leaving={killShown.leaving}
          onClose={() => setConfirmKill(null)} onConfirm={() => kill(killShown.value)}>
          <p>Delete "{killShown.value.name}" and its itinerary, packing list, and shared access? This cannot be undone.</p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
