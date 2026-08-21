'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, Loader2, Check, TriangleAlert, RotateCw } from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import { addDays, todayISO, nextSortOrder } from '@/lib/util';

export default function PlanPage() {
  return (
    <AppProvider>
      <Suspense fallback={<div className="gate"><div className="muted">Loading…</div></div>}>
        <Planner />
      </Suspense>
    </AppProvider>
  );
}

const STEPS = [
  { id: 'think', label: 'Reading your request' },
  { id: 'plan', label: 'Building the day-by-day plan' },
  { id: 'save', label: 'Saving it to your trips' },
];

function Planner() {
  const params = useSearchParams();
  const router = useRouter();
  const { supabase, user, fail } = useApp();
  const query = (params.get('q') || '').trim();

  const [step, setStep] = useState('think');
  const [error, setError] = useState('');
  const [noKey, setNoKey] = useState(false);
  const [summary, setSummary] = useState('');
  const started = useRef(false);

  const run = useCallback(async () => {
    if (!supabase || !user || !query) return;
    setError(''); setNoKey(false); setStep('think');

    let plan;
    try {
      setStep('plan');
      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: query, today: todayISO() }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (body.code === 'no_key') setNoKey(true);
        setError(body.error || 'Planning failed.');
        return;
      }
      plan = body;
    } catch (e) {
      setError('Could not reach the planner. Check your connection and try again.');
      return;
    }

    setSummary(plan.summary || '');
    setStep('save');

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

    if (tripErr || !trip) { fail(tripErr || new Error('Could not create the trip.')); setError('Could not save the trip.'); return; }

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

    if (rows.length) {
      const { error: actErr } = await supabase.from('activities').insert(rows);
      // A trip with no activities still beats losing the whole thing.
      if (actErr) fail(actErr);
    }

    router.replace(`/trips/${trip.id}/itinerary`);
  }, [supabase, user, query, router, fail]);

  useEffect(() => {
    if (started.current || !supabase || !user) return;
    started.current = true;
    run();
  }, [supabase, user, run]);

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

  return (
    <div className="shell">
      <TopBar />
      <main className="main main-plain">
        <div className="wrap planwrap">
          <div className="planning card">
            <div className="planning-head">
              <span className="planning-ico" aria-hidden="true"><Sparkles size={18} /></span>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 17 }}>{error ? 'That did not work' : 'Planning your trip'}</h2>
                <p className="small muted planning-q">&ldquo;{query}&rdquo;</p>
              </div>
            </div>

            {error ? (
              <>
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
                    <button className="btn primary" onClick={() => { started.current = true; run(); }}>
                      <RotateCw size={15} /> Try again
                    </button>
                  ) : null}
                  <Link className="btn" href="/trips">Build it by hand instead</Link>
                </div>
              </>
            ) : (
              <>
                <ol className="planning-steps">
                  {STEPS.map((s) => {
                    const idx = STEPS.findIndex((x) => x.id === step);
                    const mine = STEPS.findIndex((x) => x.id === s.id);
                    const state = mine < idx ? 'done' : mine === idx ? 'busy' : 'todo';
                    return (
                      <li key={s.id} className={`pstep is-${state}`}>
                        <span className="pstep-ico" aria-hidden="true">
                          {state === 'done' ? <Check size={14} />
                            : state === 'busy' ? <Loader2 size={14} className="spin" />
                              : <span className="pstep-dot" />}
                        </span>
                        {s.label}
                      </li>
                    );
                  })}
                </ol>
                {summary ? <p className="small muted planning-summary">{summary}</p> : null}
                <p className="tiny dim" style={{ marginBottom: 0 }}>
                  This usually takes a few seconds. You can edit everything afterwards.
                </p>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
