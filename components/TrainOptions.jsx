'use client';
import { useEffect, useState } from 'react';
import { ChevronLeft, MapPin } from 'lucide-react';
import {
  LineBadge, OperatorMark, ICCard, ExitBadge, PlatformChip, WalkIcon, TagChip, RichTip,
} from '@/components/TrainBits';
import { summaryOf, barOf, stepsOf, linesOf, directionOf } from '@/lib/trainView';
import { fmtMinute } from '@/lib/util';
import { fareText } from '@/lib/fareText';
import { Ticket } from 'lucide-react';
import s from './TrainOptions.module.css';

/**
 * The ways to go by train between two stops, to compare and choose from
 * (lib/trainOptions): one card each, fastest first, with its tags, fare,
 * journey bar and lines; opened, its steps, and a button to use it for this
 * hop from now on.
 *
 * The same panel on the trip map, planning a day (mode 'plan', usual weekday
 * times), and in directions, leaving now (mode 'now', the next trains).
 *
 *   options        from the routes API's answer
 *   to             where the hop ends, for the last step
 *   shownId        the option the map draws; onShow(id) when another is opened
 *   savedId        the option saved for this hop; onUse(id) saves one, onUse(null) removes it
 *   onLeg          (option, legIndex) when a train's step is tapped, for its departures
 *   onBack         back to what the panel replaced, labelled backLabel
 *   preferMissing  the saved route's lines do not run then
 */
export default function TrainOptions({
  options = [], mode = 'plan', title, sub, note, to = '',
  shownId = null, onShow, savedId = null, onUse, onLeg, onBack, backLabel = 'Back',
  preferMissing = false,
}) {
  const [open, setOpen] = useState(() => shownId || (options[0] && options[0].id) || null);
  const [hover, setHover] = useState(null); // { id, piece }
  const [stopsOpen, setStopsOpen] = useState(() => new Set());
  // An option shown from elsewhere (clicked on the map) opens here too.
  useEffect(() => { if (shownId) setOpen(shownId); }, [shownId]);
  /*
   * What Use or Remove just did, shown at once: the hop's options are asked
   * for again with the route saved, and say so themselves when they come.
   */
  const [using, setUsing] = useState(undefined);
  useEffect(() => { setUsing(undefined); }, [savedId]);
  const saved = using !== undefined ? using : savedId;
  function use(id) {
    setUsing(id);
    onUse(id);
  }
  const longest = Math.max(1, ...options.map((o) => o.seconds));

  function toggle(o) {
    const next = open === o.id ? null : o.id;
    setOpen(next);
    if (next && onShow) onShow(next);
  }
  function toggleStops(key) {
    setStopsOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className={s.panel}>
      <div className={s.head}>
        {onBack ? (
          <button type="button" className={`btn sm ${s.back}`} onClick={onBack}>
            <ChevronLeft size={15} aria-hidden="true" /> {backLabel}
          </button>
        ) : null}
        {title ? <h3 className={s.title} title={title}>{title}</h3> : null}
        {sub ? <p className={s.sub}>{sub}</p> : null}
        {note ? <p className={s.note}>{note}</p> : null}
        {preferMissing ? (
          <p className={s.missing}>Your saved lines aren&rsquo;t running then, so the fastest comes first.</p>
        ) : null}
      </div>

      <div className={s.list}>
        {options.map((o) => {
          const isOpen = open === o.id;
          const estimate = o.source === 'model';
          const minutes = Math.round(o.seconds / 60);
          const pieces = barOf(o, { to });
          const total = pieces.reduce((n, p) => n + p.minutes, 0) || 1;
          const tipped = hover && hover.id === o.id ? pieces[hover.piece] : null;
          let before = 0;
          const centres = pieces.map((p) => { const c = before + p.minutes / 2; before += p.minutes; return c; });
          const width = (o.seconds / longest) * 100;
          const firstRide = o.legs.find((l) => l.kind === 'ride');
          const tags = [...(o.id === saved && !o.tags.includes('saved') ? ['saved'] : []), ...o.tags.filter((t) => t !== 'saved' || o.id === saved)];
          return (
            <section key={o.id} className={s.card} data-open={isOpen ? '' : undefined}
              data-shown={o.id === shownId ? '' : undefined}>
              <button type="button" className={s.summary} aria-expanded={isOpen} onClick={() => toggle(o)}>
                <span className={s.top}>
                  {mode === 'now' && firstRide && firstRide.next != null ? (
                    <span className={s.times}>
                      <span className={s.span}>{fmtMinute(firstRide.leaves - minutesBefore(o))} → {fmtMinute(firstRide.leaves - minutesBefore(o) + minutes)}</span>
                      <span className={s.mins}>{minutes} min</span>
                    </span>
                  ) : (
                    <span className={s.big}>{estimate ? '~' : ''}{minutes}<span className={s.unit}> min</span></span>
                  )}
                  {tags.map((t) => <TagChip key={t} tag={t} currency={o.fare ? o.fare.currency : undefined} />)}
                  {o.fare ? (
                    <span className={s.fare} data-tip={o.fare.upTo ? 'One fare or the other, by the distance ridden' : undefined}>
                      {byCard(o.fare) ? <ICCard /> : <Ticket size={15} className={s.ticket} aria-hidden="true" />} {fareText(o.fare)}
                    </span>
                  ) : null}
                </span>
                <span className={s.barRow} onMouseLeave={() => setHover(null)}>
                  <span className={s.bar} style={{ width: `${width}%` }}>
                    {pieces.map((p, i) => (
                      <span key={i} className={s.piece} data-kind={p.kind}
                        style={{ flexGrow: p.minutes, '--fill': p.colour || undefined }}
                        onMouseEnter={() => setHover({ id: o.id, piece: i })} />
                    ))}
                  </span>
                  {tipped ? (
                    <span className={s.barTip}>
                      <span className={s.caret} style={{ left: `calc(${(width * centres[hover.piece]) / total}% - 5px)` }} />
                      <RichTip tip={tipped.tip} />
                    </span>
                  ) : null}
                </span>
                <span className={s.lines}>
                  {linesOf(o).map((l) => <LineBadge key={l.id} line={l} />)}
                  <span className={s.summaryText}>{summaryOf(o, mode)}</span>
                </span>
              </button>

              {isOpen ? (
                <div className={s.body}>
                  <ol className={s.steps}>
                    {stepsOf(o, { to }).map((st, k) => {
                      if (st.kind === 'walk') {
                        return (
                          <li key={k} className={s.step} data-kind="walk">
                            <span className={s.rail}><WalkIcon /></span>
                            <span className={s.walkText}>
                              {st.exit ? <ExitBadge label={st.exit} /> : null}
                              <span>{st.text}</span>
                            </span>
                          </li>
                        );
                      }
                      if (st.kind === 'end') {
                        return (
                          <li key={k} className={s.step} data-kind="end">
                            <span className={s.rail}><MapPin size={16} className={s.pin} aria-hidden="true" /></span>
                            <span className={s.station}>{st.text}</span>
                          </li>
                        );
                      }
                      return (
                        <RideStep key={k} option={o} index={st.index} leg={st.leg} mode={mode}
                          stopsShown={stopsOpen.has(`${o.id}:${st.index}`)}
                          onStops={() => toggleStops(`${o.id}:${st.index}`)}
                          onLeg={onLeg && o.source === 'timetable' ? () => onLeg(o, st.index) : null} />
                      );
                    })}
                  </ol>

                  {o.fare ? <FareBox fare={o.fare} /> : null}

                  {onUse ? (
                    <>
                      <button type="button" className={`btn ${o.id === saved ? '' : 'primary'} ${s.use}`}
                        aria-label={o.id === saved ? 'Stop using this route for this hop' : 'Use this route for this hop'}
                        onClick={() => use(o.id === saved ? null : o.id)}>
                        {o.id === saved ? 'Remove' : 'Use'}
                      </button>
                      {o.id === saved ? <p className={s.saved}>Saved to the trip for next time.</p> : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// Minutes from setting off to the first train leaving: the walk and the wait before it.
function minutesBefore(option) {
  let n = 0;
  for (const l of option.legs) { if (l.kind === 'ride') break; n += l.minutes; }
  return n;
}

/*
 * A train's step: where it is boarded, the line and who runs it, which way it
 * goes and how many stops (which open to name them), how often, and where to
 * get off. Tapped, it shows the line's departures, where there is a timetable.
 */
function RideStep({ option, index, leg, mode, stopsShown, onStops, onLeg }) {
  const count = leg.stops.length + 1;
  const tap = onLeg ? {
    role: 'button',
    tabIndex: 0,
    onClick: onLeg,
    onKeyDown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onLeg(); } },
    'aria-label': `${leg.line.name} from ${leg.from}: departures`,
  } : {};
  return (
    <li className={s.step} data-kind="ride" data-taps={onLeg ? '' : undefined}
      style={{ '--line': leg.line.colour || (leg.line.operator && leg.line.operator.colour) || 'var(--text-3)' }} {...tap}>
      <span className={s.rail}>
        <LineBadge line={leg.line} compact />
        <span className={s.track} aria-hidden="true" />
      </span>
      <span className={s.ride}>
        <span className={s.stationRow}>
          {mode === 'now' && leg.leaves != null ? <span className={s.at}>{fmtMinute(leg.leaves)}</span> : null}
          <span className={s.station}>{leg.from}</span>
          <PlatformChip label={leg.platform} />
        </span>
        <span className={s.lineRow}>
          <span>{leg.line.name}</span>
          {leg.line.operator ? (
            <span className={s.opGroup}>
              <span className={s.dot}>·</span>
              <OperatorMark operator={leg.line.operator} />
              {/* The mark alone where the line's name already says who runs it. */}
              {leg.line.name.includes(leg.line.operator.name) ? null : <span className={s.op}>{leg.line.operator.name}</span>}
            </span>
          ) : null}
        </span>
        <span className={s.dir}>
          {directionOf(leg)}
          {leg.through ? ' · same train' : ''}
          {' · '}
          {count > 1 ? (
            <button type="button" className={s.stopsBtn} aria-expanded={stopsShown}
              onClick={(e) => { e.stopPropagation(); onStops(); }}
              onKeyDown={(e) => e.stopPropagation()}>
              {count} stop{count === 1 ? '' : 's'}
            </button>
          ) : '1 stop'}
          {` · ${leg.minutes} min`}
        </span>
        {stopsShown && leg.stops.length ? (
          <ul className={s.passed}>
            {leg.stops.map((p, i) => (
              <li key={i}>
                {mode === 'now' && p.time != null ? <span className={s.at}>{fmtMinute(p.time)}</span> : null}
                {p.name}
              </li>
            ))}
          </ul>
        ) : null}
        {leg.every || leg.next != null ? (
          <span className={s.every}>
            {leg.every ? `Every ${leg.every} min` : ''}
            {mode === 'now' && leg.next != null ? `${leg.every ? ' · ' : ''}next ${fmtMinute(leg.next)}` : ''}
          </span>
        ) : null}
        <span className={s.stationRow}>
          {mode === 'now' && leg.arrives != null ? <span className={s.at}>{fmtMinute(leg.arrives)}</span> : null}
          <span className={s.station}>{leg.to}</span>
        </span>
      </span>
    </li>
  );
}

// Paid with the country's stored-value card ('ic' is how routes cached before the registry say so).
const byCard = (fare) => fare.basis === 'card' || fare.basis === 'ic';

/** The fare: one line for one operator, a line each and the total for several. */
function FareBox({ fare }) {
  const how = byCard(fare)
    ? <><ICCard /> <b>{fare.card || 'IC card'}</b></>
    : <><Ticket size={15} className={s.ticket} aria-hidden="true" /> <b>Fare</b></>;
  const parts = fare.parts.filter((p) => !p.discount);
  if (parts.length === 1 && parts.length === fare.parts.length) {
    const [part] = parts;
    return (
      <div className={s.fareBox}>
        <span className={s.fareLine}>
          {how}
          {part.operator ? <><span className={s.dot}>·</span><OperatorMark operator={part.operator} /> {part.operator.name}</> : null}
        </span>
        <span className={s.yen}>{fareText(fare)}</span>
      </div>
    );
  }
  return (
    <div className={s.fareBox} data-split="">
      {fare.parts.map((p, i) => (
        <span key={i} className={s.farePart}>
          <span className={s.fareLine}>
            {p.discount ? 'Changing between the two' : <>{p.operator ? <OperatorMark operator={p.operator} /> : null} {p.operator ? p.operator.name : ''}</>}
          </span>
          <span className={s.yen}>{fareText(p, fare.currency)}</span>
        </span>
      ))}
      <span className={s.fareTotal}>
        <span className={s.fareLine}>{how}</span>
        <span className={s.yen}>{fareText(fare)}</span>
      </span>
    </div>
  );
}
