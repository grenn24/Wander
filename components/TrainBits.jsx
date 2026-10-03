'use client';
import {
  Zap, JapaneseYen, ArrowLeftRight, Ticket, Pin, Footprints, CreditCard, TrainFront,
} from 'lucide-react';
import s from './TrainBits.module.css';

/*
 * The small pieces a train is shown with, the same wherever it is shown: the
 * badge on its line's station signs, its operator's mark, the IC card a fare
 * is paid with, a station exit, a platform, an option's tags, and the
 * three-line tooltip.
 */

/**
 * A line as its station signs show it: its letters in a ring of its colour,
 * round for subways and private lines, square for JR. A Shinkansen without
 * letters shows a train; any other line without them, a bar of its colour
 * and its name.
 */
export function LineBadge({ line, size = 'md', named = false, compact = false }) {
  if (!line) return null;
  const ring = line.colour || (line.operator && line.operator.colour) || 'var(--text-3)';
  if (line.code || line.vehicle === 'HIGH_SPEED_TRAIN') {
    return (
      <span className={s.badgeWrap}>
        <span className={s.badge} data-size={size} data-shape={line.shape === 'square' ? 'square' : 'round'}
          style={{ '--ring': ring }} aria-label={named ? undefined : line.name} role={named ? undefined : 'img'}>
          {line.code ? <span aria-hidden="true">{line.code}</span> : <TrainFront size={size === 'sm' ? 11 : 13} aria-hidden="true" />}
        </span>
        {named ? <span className={s.badgeName}>{line.name}</span> : null}
      </span>
    );
  }
  // Where there is no room for a name (a step's rail, a chip): a ring of the line's colour, named for screen readers.
  if (compact) {
    return <span className={s.blank} data-size={size} style={{ '--ring': ring }} role="img" aria-label={line.name} />;
  }
  return (
    <span className={s.bar} data-size={size} style={{ '--ring': ring }}>
      <span className={s.barSwatch} aria-hidden="true" />
      <span className={s.barName}>{line.name}</span>
    </span>
  );
}

/**
 * An operator: its logo on a white tile, as on a station sign, or where there
 * is none its initials on its colour; its name for screen readers either way.
 */
export function OperatorMark({ operator }) {
  if (!operator) return null;
  if (operator.logo) {
    return (
      <span className={s.logo} role="img" aria-label={operator.name}>
        <img src={operator.logo} alt="" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={s.operator} style={{ '--op': operator.colour }} role="img" aria-label={operator.name}>
      <span aria-hidden="true">{operator.mark}</span>
    </span>
  );
}

/** The card a fare is paid with: a contactless card, not any one company's. */
export function ICCard({ size = 15 }) {
  return <CreditCard size={size} className={s.ic} aria-hidden="true" />;
}

/** A station exit, in the yellow of Japanese exit signs. */
export function ExitBadge({ label }) {
  if (!label) return null;
  return <span className={s.exit}>{label}</span>;
}

/** The platform a line usually uses here. */
export function PlatformChip({ label }) {
  if (!label) return null;
  return <span className={s.platform} data-tip="The platform this line usually uses here">{label}</span>;
}

export function WalkIcon({ size = 14 }) {
  return <Footprints size={size} className={s.walk} aria-hidden="true" />;
}

const TAGS = {
  fastest: { icon: Zap, label: 'Fastest' },
  cheapest: { icon: JapaneseYen, label: 'Cheapest' },
  'jr-only': { icon: Ticket, label: 'JR only' },
};

/** One of an option's tags; a saved route is its pin alone. */
export function TagChip({ tag }) {
  if (tag === 'saved') {
    return (
      <span className={s.tag} data-saved="" role="img" aria-label="Saved for this hop">
        <Pin size={12} aria-hidden="true" />
      </span>
    );
  }
  let def = TAGS[tag];
  if (!def && tag.startsWith('changes:')) {
    const n = Number(tag.slice(8));
    def = { icon: ArrowLeftRight, label: `${n} change${n === 1 ? '' : 's'}` };
  }
  if (!def) return null;
  const Icon = def.icon;
  return (
    <span className={s.tag}>
      <Icon size={12} aria-hidden="true" />
      {def.label}
    </span>
  );
}

/**
 * The tooltip for a piece of a journey, the same on the map and on its bar:
 * what it is (badges, the walking icon, the exit), from where to where and
 * how long, and in grey the operator and how often.
 *
 *   tip  { lines: [line], walk, exit, title, body, meta, operator }
 */
export function RichTip({ tip, className = '', style }) {
  if (!tip) return null;
  return (
    <span role="tooltip" className={`${s.tip} ${className}`} style={style}>
      <span className={s.tipHead}>
        {(tip.lines || []).map((l) => <LineBadge key={l.id} line={l} size="sm" />)}
        {tip.walk ? <WalkIcon size={15} /> : null}
        {tip.exit ? <ExitBadge label={tip.exit} /> : null}
        <span className={s.tipTitle}>{tip.title}</span>
      </span>
      {tip.body ? <span className={s.tipBody}>{tip.body}</span> : null}
      {tip.meta ? (
        <span className={s.tipMeta}>
          {tip.operator ? <OperatorMark operator={tip.operator} /> : null}
          <span>{tip.meta}</span>
        </span>
      ) : null}
    </span>
  );
}
