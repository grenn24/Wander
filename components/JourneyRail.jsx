'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import JourneyCard from '@/components/JourneyCard';
import { MONTHS, filterJourneys } from '@/lib/journeyKit';
import s from './Journeys.module.css';

/*
 * A few journeys beside the moment of starting a trip.
 *
 * Next month rather than this one: by the time a trip is planned and booked,
 * this month is mostly gone. Loads after the page, and quietly disappears if
 * the catalogue cannot be fetched — it is a suggestion, never in the way.
 */
export default function JourneyRail({ title = 'Or start from a journey' }) {
  const [list, setList] = useState(null);
  const [month, setMonth] = useState(0);

  useEffect(() => {
    let alive = true;
    setMonth((new Date().getMonth() + 1) % 12 + 1);
    fetch('/api/journeys')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setList((d && d.journeys) || []); })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, []);

  if (list && !list.length) return null;
  const picks = list && month ? filterJourneys(list, { month }).slice(0, 8) : [];
  if (list && month && !picks.length) return null;

  return (
    <section className={s.rail} aria-label="Journeys to start from">
      <div className={s.railHead}>
        {/* Untitled where the page already has a heading for it. */}
        <div>
          {title ? <h3 className={s.railTitle}>{title}</h3> : null}
          <p className={title ? s.railSub : s.railTitle}>
            {month ? `Good in ${MONTHS[month - 1]}` : ' '}
          </p>
        </div>
        <Link className={s.railAll} href={month ? `/journeys?month=${month}` : '/journeys'}>
          All journeys <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <div className={s.railRow}>
        {list
          ? picks.map((j) => <JourneyCard key={j.slug} journey={j} month={month} mini />)
          : [0, 1, 2, 3].map((i) => <div key={i} className={`skel ${s.skelCard}`} />)}
      </div>
    </section>
  );
}
