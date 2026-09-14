'use client';
import { useEffect, useMemo, useState } from 'react';
import { Search, BookOpen } from 'lucide-react';
import JourneyCard from '@/components/JourneyCard';
import { REGIONS, MONTHS, filterJourneys, regionLabel } from '@/lib/journeyKit';
import s from './Journeys.module.css';

/*
 * The catalogue and its three questions: where, when, and anything in
 * particular. Kept in the address as well as in state, so "journeys good in
 * October" can be linked to and survives the back button.
 */
function readParams() {
  const p = new URLSearchParams(window.location.search);
  const month = Number(p.get('month'));
  return {
    q: (p.get('q') || '').slice(0, 80),
    region: REGIONS.some((r) => r.id === p.get('region')) ? p.get('region') : '',
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 0,
  };
}

export default function JourneyBrowser({ journeys }) {
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [month, setMonth] = useState(0);
  const [now, setNow] = useState(0);

  // After mount, so the prerendered page and the first client render agree.
  useEffect(() => {
    const start = readParams();
    setQ(start.q); setRegion(start.region); setMonth(start.month);
    setNow(new Date().getMonth() + 1);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (region) p.set('region', region);
    if (month) p.set('month', String(month));
    const next = `${window.location.pathname}${p.toString() ? `?${p}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [q, region, month]);

  const list = useMemo(() => filterJourneys(journeys, { q, region, month }), [journeys, q, region, month]);
  const narrowed = !!(q.trim() || region || month);

  function clear() { setQ(''); setRegion(''); setMonth(0); }

  return (
    <>
      <header className={s.head}>
        <span className={s.eyebrow}><BookOpen size={13} aria-hidden="true" /> Journeys</span>
        <h1 className={s.h1}>Start from a journey</h1>
        <p className={s.lede}>
          The shape of a good trip, written down. Keep the moments you like and Wander plans your version.
        </p>
      </header>

      <div className={s.filters} role="search">
        <label className={s.search}>
          <Search size={17} aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Country, city or mood" aria-label="Search journeys" maxLength={80} />
        </label>
        <div className={s.row} role="group" aria-label="Region">
          <button type="button" className={s.chip} aria-pressed={!region} onClick={() => setRegion('')}>
            Anywhere
          </button>
          {REGIONS.map((r) => (
            <button key={r.id} type="button" className={s.chip} aria-pressed={region === r.id}
              onClick={() => setRegion(region === r.id ? '' : r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className={s.row} role="group" aria-label="When">
          <span className={s.rowLabel} aria-hidden="true">When</span>
          <button type="button" className={s.chip} aria-pressed={!month} onClick={() => setMonth(0)}>
            Any time
          </button>
          {MONTHS.map((m, i) => (
            <button key={m} type="button" className={`${s.chip} ${s.monthChip}`}
              aria-pressed={month === i + 1} aria-label={`${m}${now === i + 1 ? ' (this month)' : ''}`}
              data-now={now === i + 1 ? '' : undefined}
              onClick={() => setMonth(month === i + 1 ? 0 : i + 1)}>
              {m.slice(0, 3)}
            </button>
          ))}
        </div>
      </div>

      <p className={s.count} aria-live="polite">
        <span>
          {list.length} {list.length === 1 ? 'journey' : 'journeys'}
          {month ? ` good in ${MONTHS[month - 1]}` : ''}
          {region ? ` · ${regionLabel(region)}` : ''}
        </span>
        {narrowed ? <button type="button" className={s.clear} onClick={clear}>Clear</button> : null}
      </p>

      {list.length ? (
        <div className={s.grid}>
          {list.map((j) => <JourneyCard key={j.slug} journey={j} month={month} />)}
        </div>
      ) : (
        <div className={s.none}>
          <p className="empty-title">Nothing fits that yet</p>
          <p className="small muted">
            {month ? `No journey here is at its best in ${MONTHS[month - 1]}.` : 'Try fewer words.'}
          </p>
          <button type="button" className="btn" onClick={clear}>Show every journey</button>
        </div>
      )}
    </>
  );
}
