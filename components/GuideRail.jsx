'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import GuideCard from '@/components/GuideCard';
import { MONTHS, filterGuides } from '@/lib/guideKit';
import s from './Guides.module.css';

/*
 * A few guides beside the moment of starting a trip.
 *
 * Next month rather than this one: by the time a trip is planned and booked,
 * this month is mostly gone. Loads after the page, and quietly disappears if
 * the catalogue cannot be fetched — it is a suggestion, never in the way.
 */
export default function GuideRail({ title = 'Or start from a guide' }) {
  const [list, setList] = useState(null);
  const [month, setMonth] = useState(0);

  useEffect(() => {
    let alive = true;
    setMonth((new Date().getMonth() + 1) % 12 + 1);
    fetch('/api/guides')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setList((d && d.guides) || []); })
      .catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, []);

  if (list && !list.length) return null;
  const picks = list && month ? filterGuides(list, { month }).slice(0, 8) : [];
  if (list && month && !picks.length) return null;

  return (
    <section className={s.rail} aria-label="Guides to start from">
      <div className={s.railHead}>
        {/* Untitled where the page already has a heading for it. */}
        <div>
          {title ? <h3 className={s.railTitle}>{title}</h3> : null}
          <p className={title ? s.railSub : s.railTitle}>
            {month ? `Good in ${MONTHS[month - 1]}` : ' '}
          </p>
        </div>
        <Link className={s.railAll} href={month ? `/guides?month=${month}` : '/guides'}>
          All guides <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
      <div className={s.railRow}>
        {list
          ? picks.map((j) => <GuideCard key={j.slug} guide={j} month={month} mini />)
          : [0, 1, 2, 3].map((i) => <div key={i} className={`skel ${s.skelCard}`} />)}
      </div>
    </section>
  );
}
