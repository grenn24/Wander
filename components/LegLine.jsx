'use client';
import { Footprints, TrainFront, Car, TriangleAlert } from 'lucide-react';
import TravelEstimate from '@/components/TravelEstimate';
import { fmtKm } from '@/lib/geo';
import { fmtDuration } from '@/lib/util';
import { TRAVEL_LABEL, whyEstimate } from '@/lib/travel';
import s from './LegLine.module.css';

const ICON = { WALK: Footprints, TRANSIT: TrainFront, DRIVE: Car };

/**
 * The way from one stop to the next, between them in a list.
 *
 * With the map's Routes off it is what it always was: the straight-line
 * distance and a rule of thumb. With them on, the straight-line distance
 * stays — it is the one number that is never a guess — and beside it each way
 * of getting there and how long it takes: 🚶 18m · 🚆 9m · 🚗 6m. A time with ~
 * is an estimate: a train in Japan outside greater Tokyo, worked out over the
 * real lines from how often trains run, or a way nothing can route at all;
 * the way the map is drawing is picked out; and where the time between two
 * activities is shorter than the quickest way between them, it says so.
 *
 * Each way is also a button: the map's Routes setting decides how every hop
 * is drawn, and a click on one way draws this hop that way instead — the train
 * for the long hop across town when the setting says walk. Clicked again, the
 * hop goes back to following the setting.
 *
 *   km        the straight-line distance
 *   leg       this hop from useLegs, or nothing while Routes are off
 *   gap       minutes between the two activities, where known
 *   onChoose  called with the way chosen for this hop, or null to follow the setting
 */
export default function LegLine({ km, leg, gap = null, onChoose = null }) {
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
          const time = o.waiting ? '' : `${o.estimate ? '~' : ''}${fmtDuration(o.minutes) || '1m'}`;
          // Which train it is, not where the time came from: the ~ already says when it is a guess.
          const lines = (o.lines || []).join(' → ');
          const reason = o.estimate && !o.source ? whyEstimate(leg.country, o.mode) : '';
          const why = o.waiting ? 'Working it out'
            : o.source === 'walk' ? 'Walking is quicker'
              : o.source === 'model' ? (lines ? `${lines} · estimated` : 'Estimated from train frequency')
                : o.estimate ? `Estimate${reason ? `: ${reason}` : ''}`
                  : lines;
          const chosen = o.mode === leg.chosen;
          const said = `${TRAVEL_LABEL[o.mode]}: ${o.waiting ? 'working it out' : `${o.estimate ? 'about ' : ''}${fmtDuration(o.minutes) || '1m'}`}`;
          const shared = {
            className: s.way,
            'data-on': o.mode === leg.drawn ? '' : undefined,
            'data-chosen': chosen ? '' : undefined,
            'data-estimate': o.estimate ? '' : undefined,
            'data-waiting': o.waiting ? '' : undefined,
          };
          if (!onChoose) {
            return (
              <span key={o.mode} {...shared} data-tip={why || undefined} aria-label={said}>
                <Icon size={12} aria-hidden="true" />{time}
              </span>
            );
          }
          return (
            <button key={o.mode} type="button" {...shared} aria-pressed={o.mode === leg.drawn}
              data-tip={chosen ? (why ? `${why} · chosen, click to undo` : 'Chosen, click to undo') : (why || undefined)}
              aria-label={chosen ? `${said}, chosen for this hop` : `${said}. Show this hop by ${TRAVEL_LABEL[o.mode].toLowerCase()}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChoose(chosen ? null : o.mode);
              }}>
              <Icon size={12} aria-hidden="true" />{time}
            </button>
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
