import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import MonthStrip from '@/components/MonthStrip';
import { daysLabel, placeLine } from '@/lib/journeyKit';
import s from './Journeys.module.css';

/**
 * A journey on a shelf: the picture and the name lead, the season sits at the
 * foot where the eye lands last. `mini` is the rail's version, which has room
 * for a name and not a sentence.
 */
export default function JourneyCard({ journey: j, month = 0, mini = false }) {
  return (
    <Link href={`/journeys/${j.slug}`} className={`${s.card}${mini ? ` ${s.mini}` : ''}`}>
      <span className={s.cover}>
        {j.cover_ref ? (
          <img src={`/api/places/photo?ref=${encodeURIComponent(j.cover_ref)}&w=${mini ? 480 : 720}`}
            alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={s.coverBlank} aria-hidden="true"><BookOpen size={26} /></span>
        )}
        <span className={s.badge}>{daysLabel(j)}</span>
        {j.cover_author && !mini ? <span className={s.credit}>Photo: {j.cover_author}</span> : null}
      </span>
      <span className={s.body}>
        <span className={s.kicker}>{mini ? j.country : placeLine(j)}</span>
        <span className={s.title}>{j.title}</span>
        {mini ? null : <span className={s.teaser}>{j.teaser}</span>}
        <span className={s.cardFoot}><MonthStrip journey={j} highlight={month} /></span>
      </span>
    </Link>
  );
}
