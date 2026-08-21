'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Loader2, TriangleAlert, RotateCw, MapPin, Wallet, CalendarDays, Check,
} from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
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

  const [meta, setMeta] = useState(null);
  const [days, setDays] = useState([]); // [{ index, theme, activities: [] }]
  const [phase, setPhase] = useState('start'); // start | streaming | locating | saving | error
  const [error, setError] = useState('');
  const [noKey, setNoKey] = useState(false);
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
    if (!supabase || !user || !query) return;
    setError(''); setNoKey(false); setMeta(null); setDays([]); setPhase('streaming');

    let plan = null;
    try {
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query, today: todayISO() }),
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
      notes: plan.summary ? `Planned from: "${query}"\n\n${plan.summary}` : '',
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
          category: a.category,
          location: a.location,
          cost: a.cost,
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
      const { error: actErr } = await supabase.from('activities').insert(rows);
      if (actErr) fail(actErr); // a trip with no activities still beats losing it
    }

    router.replace(`/trips/${trip.id}/itinerary`);
  }, [supabase, user, query, router, fail, upsertDay]);

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

  if (!query) {
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
            <span className="planning-ico" aria-hidden="true">
              {phase === 'error' ? <TriangleAlert size={18} /> : <Sparkles size={18} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: 18 }}>
                {phase === 'error' ? 'That did not work'
                  : meta && meta.name ? meta.name
                    : 'Planning your trip'}
              </h2>
              <p className="small muted planning-q">&ldquo;{query}&rdquo;</p>
            </div>
          </div>

          {phase === 'error' ? (
            <div className="card">
              <div className="planning-err">
                <TriangleAlert size={16} />
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
                {!noKey ? (
                  <button className="btn primary" onClick={() => run()}>
                    <RotateCw size={15} /> Try again
                  </button>
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
                {phase === 'locating' ? (
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
