'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, CalendarDays, MapPin, Wallet, ArrowRight, UserRound, LayoutGrid, Rows3,
} from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import TripModal from '@/components/TripModal';
import PlanPrompt from '@/components/PlanPrompt';
import { addDays, fmtRange, money, todayISO, tripStatus } from '@/lib/util';

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
  const { supabase, user, fail, pushToast } = useApp();
  const router = useRouter();
  const [trips, setTrips] = useState([]);
  const [view, setView] = useState('cards'); // cards | list
  // trip id -> who owns it, for the ones somebody else does.
  const [sharedBy, setSharedBy] = useState({});
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('trips').select('*').order('start_date', { ascending: false });
    if (error) fail(error); else setTrips(data || []);
    setLoading(false);

    /*
     * Whose trips these are.
     *
     * A trip someone shared with you sits in this list looking exactly like
     * one you started, which matters most in the case where it matters most:
     * the moment before you change something in somebody else's plan. Asked
     * for only when there is something to ask about, and never for your own.
     */
    const theirs = (data || []).filter((t) => t.owner_id !== (user && user.id));
    if (!theirs.length) { setSharedBy({}); return; }
    const { data: owners } = await supabase.from('trip_members')
      .select('trip_id, display_name, email')
      .eq('role', 'owner')
      .in('trip_id', theirs.map((t) => t.id));
    const by = {};
    (owners || []).forEach((o) => {
      by[o.trip_id] = o.display_name
        || (o.email || '').split('@')[0]
        || 'someone else';
    });
    setSharedBy(by);
  }, [supabase, fail, user]);

  useEffect(() => { load(); }, [load]);

  /* Read after mount, not during render: the server has no localStorage and
     would send markup the first client render then disagreed with. */
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'list' || saved === 'cards') setView(saved);
    } catch (e) { /* storage off; cards it is */ }
  }, []);

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
      <TopBar />
      <main className="main main-plain">
        <div className="wrap">
          <div className="page-head spread">
            <div>
              <h2>Your trips</h2>
              <div className="small muted trips-count">
                {/* Nothing while loading: the skeleton cards below already say
                    it, and saying it twice is once too many. The line keeps its
                    height in CSS so the heading does not jump when it fills. */}
                {loading ? null
                  : trips.length === 0 ? 'Nothing planned yet'
                    : `${trips.length} trip${trips.length === 1 ? '' : 's'}`}
              </div>
            </div>
            <div className="page-head-acts">
              {/* Only worth offering once there is a list to have an opinion
                  about. */}
              {trips.length > 1 ? (
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

          {loading ? (
            <div className="tripgrid">
              <div className="skel skel-card" /><div className="skel skel-card" /><div className="skel skel-card" />
            </div>
          ) : trips.length === 0 ? (
            <div className="empty empty-lg">
              <CalendarDays size={30} className="empty-ico" aria-hidden="true" />
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
                      <span className={`statuspill is-${status}`}>{STATUS_LABEL[status]}</span>
                      <span className="triprow-name">{t.name}</span>
                      {shared}
                      <span className="triprow-meta">
                        <span><CalendarDays size={13} /> {fmtRange(t.start_date, t.end_date)}</span>
                        {t.destination ? <span><MapPin size={13} /> {t.destination}</span> : null}
                        {t.budget != null ? (
                          <span><Wallet size={13} /> {money(t.budget, t.currency)}</span>
                        ) : null}
                      </span>
                      <ArrowRight size={16} className="tripcard-go" aria-hidden="true" />
                    </Link>
                  );
                }

                return (
                  <Link key={t.id} href={`/trips/${t.id}/itinerary`} className="tripcard">
                    <div className="tripcard-top">
                      <span className={`statuspill is-${status}`}>{STATUS_LABEL[status]}</span>
                      {shared}
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

      {draft ? (
        <TripModal draft={draft} onChange={setDraft} onSave={saveTrip} onClose={() => setDraft(null)} />
      ) : null}
    </div>
  );
}
