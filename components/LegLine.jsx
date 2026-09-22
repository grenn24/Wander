'use client';
import { Footprints, TrainFront, Car, TriangleAlert } from 'lucide-react';
import TravelEstimate from '@/components/TravelEstimate';
import { fmtKm } from '@/lib/geo';
import { fmtDuration } from '@/lib/util';
import { TRAVEL_LABEL } from '@/lib/travel';
import s from './LegLine.module.css';

const ICON = { WALK: Footprints, TRANSIT: TrainFront, DRIVE: Car };

/**
 * The way from one stop to the next, between them in a list.
 *
 * With the map's Routes off it is what it always was: the straight-line
 * distance and a rule of thumb. With them on, the straight-line distance
 * stays — it is the one number that is never a guess — and beside it each way
 * of getting there and how long it takes: 🚶 18m · 🚆 9m · 🚗 6m. A time with ~
 * is an estimate, where Google cannot route that way (trains in Japan); the
 * way the map is drawing is picked out; and where the time between two
 * activities is shorter than the quickest way between them, it says so.
 *
 *   km    the straight-line distance
 *   leg   this hop from useLegs, or nothing while Routes are off
 *   gap   minutes between the two activities, where known
 */
export default function LegLine({ km, leg, gap = null }) {
  if (!leg || !leg.options || (!leg.options.length && !leg.drawn)) return <TravelEstimate km={km} />;
  const known = leg.options.filter((o) => Number.isFinite(o.minutes));
  const quickest = known.length ? Math.min(...known.map((o) => o.minutes)) : null;
  const tight = gap != null && quickest != null && quickest > gap;
  const Lead = ICON[leg.drawn] || (known[0] && ICON[known[0].mode]) || Footprints;
  return <>
    <Lead size={15} aria-hidden="true" />
    <div className={`map-leg-detail ${s.detail}`}>
      <strong data-tip="Straight-line distance">≈ {fmtKm(km)}</strong>
      <span className={s.ways}>
        {leg.options.map((o) => {
          const Icon = ICON[o.mode];
          const time = o.waiting ? '…' : `${o.estimate ? '~' : ''}${fmtDuration(o.minutes) || '1m'}`;
          const why = o.waiting ? 'Asking Google…'
            : o.estimate ? `Estimate${leg.gap ? `: Google has no ${o.mode === 'TRANSIT' ? 'transit' : TRAVEL_LABEL[o.mode].toLowerCase()} routes in ${leg.gap}` : ''}`
              : `${TRAVEL_LABEL[o.mode]}, by Google`;
          return (
            <span key={o.mode} className={s.way} data-on={o.mode === leg.drawn ? '' : undefined}
              data-estimate={o.estimate ? '' : undefined} data-tip={why}
              aria-label={`${TRAVEL_LABEL[o.mode]}: ${o.waiting ? 'working it out' : `${o.estimate ? 'about ' : ''}${fmtDuration(o.minutes) || '1m'}`}`}>
              <Icon size={12} aria-hidden="true" />{time}
            </span>
          );
        })}
      </span>
      {tight ? (
        <span className={s.tight}>
          <TriangleAlert size={12} aria-hidden="true" />
          Quickest is {fmtDuration(quickest)}, with {fmtDuration(gap) || 'no time'} between
        </span>
      ) : null}
    </div>
  </>;
}
