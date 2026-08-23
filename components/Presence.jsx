'use client';
import { useRef, useState } from 'react';
import Popover from '@/components/Popover';
import { colorFor, initials } from '@/lib/util';

/**
 * Who else has this trip open.
 *
 * The count and the faces used to be two separate things sitting side by side,
 * saying the same thing twice and running out of room on a phone — where the
 * count was simply hidden, leaving faces with no explanation. One control now:
 * a live dot, a number, and the faces, opening onto the names.
 */
export default function Presence({ online = [], meId }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);

  if (!online.length) return null;

  const label = `${online.length} ${online.length === 1 ? 'person' : 'people'} viewing this trip`;

  return (
    <>
      <button ref={btn} className={`presence${online.length < 2 ? ' is-alone' : ''}`} type="button"
        data-tip="Who is here"
        aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => setOpen((o) => !o)}>
        <span className="pulse" aria-hidden="true" />
        <span className="presence-n">{online.length}</span>
        <span className="avatars" aria-hidden="true">
          {online.slice(0, 3).map((o) => (
            <span key={o.id} className="avatar" style={{ background: colorFor(o.name) }}>
              {initials(o.name)}
            </span>
          ))}
        </span>
      </button>

      <Popover anchorEl={btn.current} open={open} width={216} onClose={() => setOpen(false)}>
        <div className="act-menu" role="menu">
          <p className="menu-who">Here right now</p>
          {online.map((o) => (
            <span className="presence-row" key={o.id} role="menuitem">
              <span className="avatar" style={{ background: colorFor(o.name), marginLeft: 0 }}>
                {initials(o.name)}
              </span>
              <span className="presence-name">
                {o.name}{meId && o.id === meId ? ' (you)' : ''}
              </span>
            </span>
          ))}
        </div>
      </Popover>
    </>
  );
}
