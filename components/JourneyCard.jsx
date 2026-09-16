import Link from 'next/link';
import { BookOpen } from 'lucide-react';
import MonthStrip from '@/components/MonthStrip';
import Flag from '@/components/Flag';
import { daysLabel, placeLine } from '@/lib/journeyKit';
import { imageURL, srcSet, sourceOf } from '@/lib/journeyFormat';
import s from './Journeys.module.css';

/**
 * A journey on a shelf: the picture and the name lead, the season sits at the
 * foot where the eye lands last. `mini` is the rail's version, which has room
 * for a name and not a sentence.
 */
export default function JourneyCard({ journey: j, month = 0, mini = false }) {
  const cover = j.cover && j.cover.raw ? j.cover : null;
  const credit = cover ? `${cover.author} · ${sourceOf(cover).name}` : j.cover_author;
  return (
    <Link href={`/journeys/${j.slug}`} className={`${s.card}${mini ? ` ${s.mini}` : ''}`}>
      <span className={s.cover} style={cover && cover.color ? { backgroundColor: cover.color } : undefined}>
        {cover ? (
          <img src={imageURL(cover, mini ? 560 : 900)}
            srcSet={srcSet(cover, mini ? [480, 720, 960] : [600, 900, 1300, 1800])}
            sizes={mini ? '236px' : '(max-width: 640px) 100vw, 380px'}
            alt="" loading="lazy" decoding="async" />
        ) : j.cover_ref ? (
          <img src={`/api/places/photo?ref=${encodeURIComponent(j.cover_ref)}&w=${mini ? 560 : 900}`}
            alt="" loading="lazy" decoding="async" />
        ) : (
          <span className={s.coverBlank} aria-hidden="true"><BookOpen size={26} /></span>
        )}
        <span className={s.badge}>{daysLabel(j)}</span>
        {credit && !mini ? <span className={s.credit}>Photo: {credit}</span> : null}
      </span>
      <span className={s.body}>
        <span className={s.kicker}><Flag code={j.flag} className={s.flag} />{mini ? j.country : placeLine(j)}</span>
        <span className={s.title}>{j.title}</span>
        {mini ? null : <span className={s.teaser}>{j.teaser}</span>}
        <span className={s.cardFoot}><MonthStrip journey={j} highlight={month} /></span>
      </span>
    </Link>
  );
}
