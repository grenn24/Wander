'use client';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Moon, Loader2 } from 'lucide-react';
import { LineBadge, OperatorMark, PlatformChip } from '@/components/TrainBits';
import TimePicker from '@/components/TimePicker';
import { departuresOf } from '@/lib/geo';
import { fmtMinute, tokyoNow } from '@/lib/util';
import s from './Departures.module.css';

/**
 * One train of a train option, and its line's departures for the rest of the
 * day (app/api/departures): the last train at the top, the time you leave,
 * the next five you can catch with when each gets you there, and More for
 * the rest of the day.
 *
 *   option, ride  the option and which of its trains (0 for the first)
 *   from, to      the hop's two ends, { lat, lng }
 *   toName        where the hop ends, for "Arrive"
 *   date          the day, YYYY-MM-DD, for its timetable
 *   leaveAt       the minute you leave, to start from
 *   live          the day is today: "in N min" while the time is still now
 */
export default function Departures({
  option, ride = 0, from, to, toName = '', date, leaveAt = 600, live = false,
  onBack, backLabel = 'Train options',
}) {
  const leg = option.legs.filter((l) => l.kind === 'ride')[ride];
  const before = minutesBefore(option, ride);
  const [leave, setLeave] = useState(leaveAt);
  const [touched, setTouched] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    // Past midnight, and before the first trains, is the end of the same service day.
    const service = leave < 180 ? leave + 1440 : leave;
    departuresOf({ from, to, option: option.id, ride, after: service + before, date })
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Could not find the trains just now.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [where(from), where(to), option.id, ride, before, date, leave]);

  const last = data && data.last;
  const list = useMemo(() => (data ? data.trains.filter((t) => !last || t.leaves !== last.leaves) : []), [data, last]);
  const types = new Set(list.map((t) => t.type).filter(Boolean));
  const shown = more ? list : list.slice(0, 5);
  const firstId = list.length ? list[0].leaves : null;
  const chosen = picked ?? firstId;
  const now = live && !touched ? tokyoNow().minute : null;

  return (
    <div className={s.panel}>
      <div className={s.head}>
        {onBack ? (
          <button type="button" className={`btn sm ${s.back}`} onClick={onBack}>
            <ChevronLeft size={15} aria-hidden="true" /> {backLabel}
          </button>
        ) : null}
        <div className={s.line}>
          <LineBadge line={leg.line} size="lg" />
          <span className={s.name}>{leg.line.name}</span>
          <OperatorMark operator={leg.line.operator} />
        </div>
        <div className={s.where}>
          <span>{(data && data.from) || leg.from} → toward {(data && data.toward) || leg.toward}</span>
          <PlatformChip label={leg.platform} />
        </div>
        {last ? (
          <div className={s.last}>
            <Moon size={15} className={s.moon} aria-hidden="true" />
            <span><b>Last train</b> <span className={s.mono}>{fmtMinute(last.leaves)}</span></span>
            <span className={s.lastArrive}>arrives <span className={s.mono}>{fmtMinute(last.arrives)}</span></span>
          </div>
        ) : null}
      </div>

      <div className={s.leave}>
        <span className={s.leaveLabel}>Leave at</span>
        <TimePicker value={leave} label="Leave at"
          onChange={(m) => { setLeave(m); setTouched(true); setMore(false); setPicked(null); }} />
      </div>

      <div className={s.body}>
        {err ? <p className={s.quiet}>{err}</p>
          : !data ? <p className={s.quiet}><Loader2 size={14} className="spin" /> Finding the trains</p>
            : !list.length && !last ? <p className={s.quiet}>No more trains from here today.</p>
              : (
                <>
                  {list.length ? (
                    <div className={s.cols}><span>Next trains</span><span>Arrive {toName}</span></div>
                  ) : <p className={s.quiet}>Only the last train is left.</p>}
                  <ol className={s.trains}>
                    {shown.map((t) => {
                      const wait = now == null ? null : t.leaves - now;
                      return (
                        <li key={t.leaves}>
                          <button type="button" className={s.train} aria-pressed={t.leaves === chosen}
                            onClick={() => setPicked(t.leaves)}>
                            <span className={s.leaves}>{fmtMinute(t.leaves)}</span>
                            <span className={s.what}>
                              {types.size > 1 && t.type ? <span className={s.type}>{t.type}</span> : null}
                              {wait != null && wait >= 0 && wait < 60 ? <span>in {wait} min</span> : null}
                            </span>
                            <span className={s.arrives}>{fmtMinute(t.arrives)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  {!more && list.length > 5 ? (
                    <button type="button" className={`btn ${s.more}`} onClick={() => setMore(true)}>More</button>
                  ) : null}
                </>
              )}
      </div>
    </div>
  );
}

const where = (p) => (p ? `${p.lat.toFixed(4)},${p.lng.toFixed(4)}` : '');

// Minutes from leaving to reaching a train's platform: everything before it but the wait for it.
function minutesBefore(option, ride) {
  let n = 0;
  let rides = 0;
  for (let i = 0; i < option.legs.length; i += 1) {
    const l = option.legs[i];
    if (l.kind === 'ride') {
      if (rides === ride) break;
      rides += 1;
    }
    const next = option.legs[i + 1];
    if (l.kind === 'wait' && next && next.kind === 'ride' && rides === ride) continue;
    n += l.minutes;
  }
  return n;
}
