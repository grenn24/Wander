import { MONTHS, monthFit } from '@/lib/journeyKit';
import s from './Journeys.module.css';

function list(months) {
  const names = months.map((m) => MONTHS[m - 1]);
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The year as twelve bars: when a journey is at its best, good, or wrong. */
export function seasonSentence(j) {
  const parts = [`Best in ${list(j.months.best)}`];
  if (j.months.good.length) parts.push(`good in ${list(j.months.good)}`);
  if ((j.months.avoid || []).length) parts.push(`avoid ${list(j.months.avoid)}`);
  return `${parts.join('; ')}.`;
}

export default function MonthStrip({ journey, highlight = 0, large = false }) {
  return (
    <span className={`${s.months}${large ? ` ${s.monthsLg}` : ''}`} role="img"
      aria-label={seasonSentence(journey)}>
      {MONTHS.map((m, i) => (
        <span key={m} className={s.month} data-fit={monthFit(journey, i + 1)}
          data-on={highlight === i + 1 ? '' : undefined}>
          <i />
          {large ? <b>{m[0]}</b> : null}
        </span>
      ))}
    </span>
  );
}
