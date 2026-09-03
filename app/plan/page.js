'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Loader2, TriangleAlert, RotateCw, MapPin, Wallet, CalendarDays, Check,
  ImageOff,
} from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import { SHOT_KEY } from '@/components/PlanPrompt';
import Loading from '@/components/Loading';
import { categoryIcon } from '@/lib/icons';
import {
  addDays, todayISO, nextSortOrder, categoryOf, fmtTime, money,
} from '@/lib/util';

export default function PlanPage() {
  return (
    <AppProvider>
      <Suspense fallback={<div className="gate"><Loading label="Warming up" /></div>}>
        <Planner />
      </Suspense>
    </AppProvider>
  );
}

function Planner() {
  const params = useSearchParams();
  const router = useRouter();
  const { supabase, user, fail } = useApp();
  const query = (params.get('q') || '').trim();
  /*
   * The pictures, if there are any, read once on mount and held for the life
   * of this page. Held rather than consumed, because "try again" has to work
   * and pictures already cleared cannot be tried again.
   */
  const [shots] = useState(() => {
    if (params.get('shots') !== '1' || typeof sessionStorage === 'undefined') return [];
    try {
      const raw = JSON.parse(sessionStorage.getItem(SHOT_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string' && u) : [];
    } catch (e) { return []; }
  });

  const [meta, setMeta] = useState(null);
  const [days, setDays] = useState([]); // [{ index, theme, activities: [] }]
  // start | reading | streaming | locating | saving | error
  const [phase, setPhase] = useState('start');
  const [error, setError] = useState('');
  const [noKey, setNoKey] = useState(false);
  // What the picture turned out to be, said back so nobody has to guess which
  // part of it was understood.
  const [read, setRead] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const started = useRef(false);
  const liveRef = useRef(null);

  const upsertDay = useCallback((i, patch) => {
    setDays((prev) => {
      const next = prev.slice();
      const at = next.findIndex((d) => d.index === i);
      if (at === -1) next.push({ index: i, theme: '', activities: [], ...patch });
      else next[at] = { ...next[at], ...patch };
      next.sort((a, b) => a.index - b.index);
      return next;
    });
  }, []);

  const run = useCallback(async () => {
    if (!supabase || !user || (!query && !shots.length)) return;
    setError(''); setNoKey(false); setMeta(null); setDays([]);
    setUnreadable(false); setRead('');

    /*
     * The picture is read before anything is planned, so "I cannot make a trip
     * out of this" arrives on an empty screen rather than halfway down a
     * half-written itinerary.
     */
    let brief = query;
    let saw = '';
    if (shots.length) {
      setPhase('reading');
      let seen;
      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: shots, said: query }),
        });
        seen = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (seen.code === 'no_key') setNoKey(true);
          if (seen.code === 'unreadable') setUnreadable(true);
          setRead(seen.read || '');
          setError(seen.error
            || `${shots.length === 1 ? 'That picture' : 'Those pictures'} could not be read.`);
          setPhase('error');
          return;
        }
      } catch (e) {
        setError('The connection dropped while reading. Try again.');
        setPhase('error');
        return;
      }
      saw = seen.read || '';
      setRead(saw);
      const from = shots.length === 1
        ? 'From a picture the traveller attached:'
        : `From ${shots.length} pictures the traveller attached:`;
      brief = query
        ? `${query}\n\n${from}\n${seen.brief}`
        : `${from}\n${seen.brief}`;
    }

    setPhase('streaming');

    let plan = null;
    try {
      /*
       * Signed, so the planner can look at the calendar.
       *
       * Without this the route has no idea who is asking and cannot fetch
       * anything on their behalf — which is exactly why the first version of
       * this planned around a calendar it had never seen.
       */
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session ? sess.session.access_token : '';

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: brief, today: todayISO() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'no_key') setNoKey(true);
        setError(body.error || 'Planning failed.');
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try { evt = JSON.parse(line); } catch (e) { continue; }
          if (evt.t === 'meta') setMeta(evt);
          else if (evt.t === 'day') upsertDay(evt.i, { theme: evt.theme });
          else if (evt.t === 'act') {
            setDays((prev) => {
              const next = prev.slice();
              const at = next.findIndex((d) => d.index === evt.d);
              if (at === -1) next.push({ index: evt.d, theme: '', activities: [evt.a] });
              else next[at] = { ...next[at], activities: [...next[at].activities, evt.a] };
              next.sort((a, b) => a.index - b.index);
              return next;
            });
          } else if (evt.t === 'error') { setError(evt.error); setPhase('error'); return; }
          else if (evt.t === 'done') plan = evt.plan;
        }
      }
    } catch (e) {
      setError('The connection dropped while planning. Try again.');
      setPhase('error');
      return;
    }

    if (!plan) { setError('The plan did not finish. Try again.'); setPhase('error'); return; }

    const start = plan.start_date || addDays(todayISO(), 21);
    const end = addDays(start, Math.max(0, plan.duration_days - 1));

    const { data: trip, error: tripErr } = await supabase.from('trips').insert({
      owner_id: user.id,
      name: plan.name,
      destination: plan.destination,
      start_date: start,
      end_date: end,
      currency: plan.currency,
      notes: plan.summary
        ? `Planned from: ${query ? `"${query}"`
          : `${shots.length === 1 ? 'a picture' : `${shots.length} pictures`} — ${saw || 'attached'}`}`
          + `\n\n${plan.summary}`
        : '',
    }).select().single();

    if (tripErr || !trip) {
      fail(tripErr || new Error('Could not create the trip.'));
      setError('Could not save the trip.');
      setPhase('error');
      return;
    }

    const rows = [];
    plan.days.forEach((d) => {
      const day = addDays(start, d.day_index - 1);
      if (day > end) return;
      d.activities.forEach((a) => {
        rows.push({
          trip_id: trip.id,
          day,
          title: a.title,
          start_time: a.start_time,
          end_time: a.end_time || null,
          category: a.category,
          subtype: a.subtype || null,
          details: a.details || {},
          location: a.location,
          cost: a.cost,
          booking_ref: a.booking_ref || '',
          notes: a.notes,
          sort_order: nextSortOrder(rows, day),
        });
      });
    });

    // Resolve every stop in one batch before writing, so the map is already
    // populated the first time it is opened rather than filling in stop by stop.
    if (rows.length) {
      setPhase('locating');
      const targets = rows
        .map((r, i) => ({ id: String(i), query: r.location }))
        .filter((t) => t.query);
      if (targets.length) {
        try {
          const res = await fetch('/api/places/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: targets, bias: plan.destination }),
          });
          if (res.ok) {
            const { results } = await res.json();
            (results || []).forEach((r) => {
              if (!r.found) return;
              const row = rows[Number(r.id)];
              if (!row) return;
              row.lat = r.lat;
              row.lng = r.lng;
              if (r.place_id) row.place_id = r.place_id;
              if (r.photo_ref) row.photo_ref = r.photo_ref;
              if (r.label) row.location = r.label;
            });
          }
        } catch (e) { /* the map can still resolve these later */ }
      }
      setPhase('saving');
      const cover = rows.find((r) => r.photo_ref);
      if (cover) {
        // The first recognisable stop becomes the trip thumbnail. The trips
        // page still falls back to its first photographed activity for older
        // plans that predate cover_ref.
        await supabase.from('trips').update({ cover_ref: cover.photo_ref }).eq('id', trip.id);
      }
      const { error: actErr } = await supabase.from('activities').insert(rows);
      if (actErr) fail(actErr); // a trip with no activities still beats losing it
    }

    router.replace(`/trips/${trip.id}/itinerary`);
  }, [supabase, user, query, shots, router, fail, upsertDay]);

  useEffect(() => {
    if (started.current || !supabase || !user) return;
    started.current = true;
    run();
  }, [supabase, user, run]);

  // Follow the newest day as it lands, without yanking the whole page.
  useEffect(() => {
    const el = liveRef.current;
    if (!el || phase !== 'streaming') return;
    el.scrollTop = el.scrollHeight;
  }, [days, phase]);

  if (!query && !shots.length) {
    return (
      <div className="shell">
        <TopBar />
        <main className="main main-plain">
          <div className="wrap">
            <div className="empty empty-lg">
              <p className="empty-title">Nothing to plan</p>
              <p className="small muted" style={{ marginTop: 0 }}>
                Describe a trip and Wander will lay out the days.
              </p>
              <Link className="btn primary" href="/trips">Go to your trips</Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const totalActs = days.reduce((s, d) => s + d.activities.length, 0);
  const expected = meta && meta.duration_days ? meta.duration_days : 0;

  return (
    <div className="shell">
      <TopBar />
      <main className="main main-plain">
        <div className="wrap planwrap">

          <div className="planhead">
            {shots.length ? (
              <span className="planhead-shots">
                {shots.map((u, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <img className="planhead-shot" src={u} alt="" key={i} />
                ))}
              </span>
            ) : null}
            <span className="planning-ico" aria-hidden="true">
              {phase === 'error'
                ? (unreadable ? <ImageOff size={18} /> : <TriangleAlert size={18} />)
                : <Sparkles size={18} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: 18 }}>
                {phase === 'error'
                  ? (unreadable
                    ? `I could not read ${shots.length === 1 ? 'that picture' : 'those pictures'}`
                    : 'That did not work')
                  : meta && meta.name ? meta.name
                    : phase === 'reading'
                      ? `Reading your picture${shots.length === 1 ? '' : 's'}`
                      : 'Planning your trip'}
              </h2>
              <p className="small muted planning-q">
                {query ? <>&ldquo;{query}&rdquo;</> : null}
                {query && read ? ' · ' : null}
                {read || (shots.length && !query
                  ? `From your picture${shots.length === 1 ? '' : 's'}` : null)}
              </p>
            </div>
          </div>

          {phase === 'error' ? (
            <div className="card">
              <div className="planning-err">
                {unreadable ? <ImageOff size={16} /> : <TriangleAlert size={16} />}
                <span>{error}</span>
              </div>
              {noKey ? (
                <p className="small muted">
                  Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev
                  server. Everything else in Wander works without it — you can still build this
                  trip by hand.
                </p>
              ) : null}
              <div className="chiprow" style={{ marginTop: 14 }}>
                {/* Reading the same picture again gets the same answer, so when
                    the picture is the problem the way forward is another one. */}
                {!noKey && !unreadable ? (
                  <button className="btn primary" onClick={() => run()}>
                    <RotateCw size={15} /> Try again
                  </button>
                ) : null}
                {unreadable ? (
                  <Link className="btn primary" href="/trips">Try other pictures</Link>
                ) : null}
                <Link className="btn" href="/trips">Build it by hand instead</Link>
              </div>
            </div>
          ) : (
            <>
              {meta && (meta.destination || meta.currency || expected) ? (
                <div className="planmeta">
                  {meta.destination ? (
                    <span><MapPin size={13} /> {meta.destination}</span>
                  ) : null}
                  {expected ? (
                    <span><CalendarDays size={13} /> {expected} day{expected === 1 ? '' : 's'}</span>
                  ) : null}
                  {meta.currency ? <span><Wallet size={13} /> {meta.currency}</span> : null}
                </div>
              ) : null}

              {meta && meta.summary ? (
                <p className="small muted planning-summary">{meta.summary}</p>
              ) : null}

              <div className="planlive" ref={liveRef}>
                {days.length === 0 ? (
                  <div className="planskel">
                    <div className="skel skel-head" />
                    <div className="skel skel-row" />
                    <div className="skel skel-row" />
                  </div>
                ) : null}

                {days.map((d) => (
                  <section className="planday" key={d.index}>
                    <div className="planday-head">
                      <span className="day-num">Day {d.index}</span>
                      <span className="planday-theme">{d.theme}</span>
                    </div>
                    {d.activities.map((a, k) => {
                      const cat = categoryOf(a.category);
                      const Icon = categoryIcon(cat.id);
                      return (
                        <div className="planact" key={`${d.index}-${k}`}>
                          <span className="planact-time mono">
                            {a.start_time ? fmtTime(a.start_time) : '—'}
                          </span>
                          <span className={`catico cat-${cat.id}`} aria-hidden="true">
                            <Icon size={13} />
                          </span>
                          <span className="planact-body">
                            <span className="planact-title">{a.title}</span>
                            {a.location ? <span className="tiny dim">{a.location}</span> : null}
                          </span>
                          {a.cost > 0 ? (
                            <span className="planact-cost mono">
                              {money(a.cost, meta ? meta.currency : '')}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>

              <div className="planfoot">
                {phase === 'reading' ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    Looking at your picture{shots.length === 1 ? '' : 's'}…
                  </>
                ) : phase === 'locating' ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    Finding {totalActs} stop{totalActs === 1 ? '' : 's'} on the map…
                  </>
                ) : phase === 'saving' ? (
                  <>
                    <Check size={15} /> {totalActs} activit{totalActs === 1 ? 'y' : 'ies'} planned
                    {' '}— saving your trip…
                  </>
                ) : (
                  <>
                    <Loader2 size={15} className="spin" />
                    {days.length === 0 ? 'Thinking about where to send you…'
                      : `Day ${days[days.length - 1].index}${expected ? ` of ${expected}` : ''}`
                        + ` · ${totalActs} activit${totalActs === 1 ? 'y' : 'ies'} so far`}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
