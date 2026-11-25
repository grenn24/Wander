'use client';
import {
  CalendarDays, Clock, Pencil, Plus, Settings, Trash2,
} from 'lucide-react';
import { expand } from '@/lib/tripChanges';
import { fmtDayTiny } from '@/lib/util';

const ICONS = {
  add_activity: Plus,
  update_activity: Pencil,
  move_activity: CalendarDays,
  delete_activity: Trash2,
  update_trip: Settings,
  shift_times: Clock,
  clear_day: Trash2,
  move_day: CalendarDays,
  edit_many: Pencil,
};

const DESTRUCTIVE = new Set(['delete_activity', 'clear_day']);

/**
 * A proposal, one line per operation, as a person checks it before applying:
 * what it does, and the day it lands on — or how many stops, for a bulk line.
 */
export default function ChangeList({ ops, activities }) {
  return (
    <ul className="cmd-ops">
      {ops.map((op, i) => {
        const Icon = ICONS[op.kind] || Pencil;
        const touches = expand(op, activities).length;
        return (
          <li key={`${op.kind}-${i}`}
            className={DESTRUCTIVE.has(op.kind) ? 'is-destructive' : ''}>
            <Icon size={14} />
            <span>{op.describe}</span>
            {/* A bulk line stands for many edits — say how many, or
                "clear day 4" reads like a single small change. */}
            {touches > 1 ? <span className="cmd-day">{touches} stops</span>
              : op.day ? <span className="cmd-day">{fmtDayTiny(op.day)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
