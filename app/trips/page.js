'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, CalendarDays, MapPin, Wallet, ArrowRight, UserRound } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import TripModal from '@/components/TripModal';
import PlanPrompt from '@/components/PlanPrompt';
import { addDays, fmtRange, money, todayISO, tripStatus } from '@/lib/util';

const STATUS_LABEL = { current: 'Under way', upcoming: 'Upcoming', past: 'Past', undated: 'No dates' };

export default function TripsHome() {
  const { supabase, user, fail, pushToast } = useApp();
  const router = useRouter();
  const [trips, setTrips] = useState([]);
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
            <button className="btn primary" onClick={openNew}>
              <Plus size={16} /> New trip
            </button>
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
            <div className="tripgrid">
              {ordered.map((t) => {
                const status = tripStatus(t);
                const from = sharedBy[t.id];
                return (
                  <Link key={t.id} href={`/trips/${t.id}/itinerary`} className="tripcard">
                    <div className="tripcard-top">
                      <span className={`statuspill is-${status}`}>{STATUS_LABEL[status]}</span>
                      {from ? (
                        <span className="sharedpill" data-tip={`${from} owns this trip`}>
                          <UserRound size={11} aria-hidden="true" />
                          Shared by {from}
                        </span>
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

      {draft ? (
        <TripModal draft={draft} onChange={setDraft} onSave={saveTrip} onClose={() => setDraft(null)} />
      ) : null}
    </div>
  );
}
