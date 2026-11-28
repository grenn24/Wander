'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight, Check, Loader2, Sparkles, X,
} from 'lucide-react';
import { useTrip } from '@/components/TripProvider';
import useApplyChanges from '@/components/useApplyChanges';
import PlaceReview from '@/components/PlaceReview';
import ChangeList from '@/components/ChangeList';
import { expandAll } from '@/lib/tripChanges';
import s from './TripAsk.module.css';

/**
 * A change to the trip that the Assistant proposed, under the answer that
 * proposed it.
 *
 * The edits are the command bar's — the same editor wrote them, and Apply
 * saves them the same way, places checked first — so the card is the command
 * bar's proposal, sitting in the conversation. Nothing is saved until Apply,
 * and what happened is kept with the chat: an applied change says so, and is
 * never offered again.
 */
export default function AskChanges({
  message, writing, last, onMark, onReply,
}) {
  const { tripId, activities } = useTrip();
  const changes = useApplyChanges();
  const [picked, setPicked] = useState([]);
  const p = message.proposal;
  const q = message.editQuestion;

  if (writing && message.proposing && !p && !q && !message.proposalError) {
    return (
      <p className={`small muted ${s.status}`}>
        <Loader2 size={14} className="spin" aria-hidden="true" />
        Preparing the changes
      </p>
    );
  }

  if (message.proposalError) {
    return <p className="err" role="alert">{message.proposalError}</p>;
  }

  /*
   * The editor needs one thing settled first. Its options are answers to
   * tap, sent as the next message — the Assistant reads the answer and asks
   * for the change again with it.
   */
  if (q) {
    const options = Array.isArray(q.options) ? q.options : [];
    const live = last && !writing;
    return (
      <div className={`cmdq ${s.changesAsk}`}>
        {q.header ? <span className="cmdq-head">{q.header}</span> : null}
        <p className="cmdq-ask"><Sparkles size={14} aria-hidden="true" />{q.ask}</p>
        {options.length ? (
          <div className="cmdq-opts" role={q.kind === 'multi' ? 'group' : 'list'}>
            {options.map((o) => {
              const on = picked.includes(o.label);
              return (
                <button key={o.label} type="button" disabled={!live}
                  aria-pressed={q.kind === 'multi' ? on : undefined}
                  className={`cmdq-opt${on ? ' is-on' : ''}`}
                  onClick={() => {
                    if (q.kind !== 'multi') { onReply(o.label); return; }
                    setPicked((was) => (on ? was.filter((x) => x !== o.label) : [...was, o.label]));
                  }}>
                  {q.kind === 'multi' ? (
                    <span className="cmdq-box" aria-hidden="true">{on ? <Check size={12} /> : null}</span>
                  ) : null}
                  <span className="cmdq-opt-main">
                    <span className="cmdq-opt-label">{o.label}</span>
                    {o.detail ? <span className="cmdq-opt-detail">{o.detail}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
        {live ? (
          <div className="cmdq-foot">
            <span className="tiny dim">{options.length ? 'Or answer in your own words below.' : 'Answer below.'}</span>
            {q.kind === 'multi' ? (
              <button className="btn sm primary" type="button" disabled={!picked.length}
                onClick={() => onReply(picked.join(', '))}>
                Continue{picked.length ? ` · ${picked.length}` : ''}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  if (!p) return null;
  const ops = Array.isArray(p.ops) ? p.ops : [];

  if (!ops.length) {
    return <p className={`small muted ${s.changesNote}`}>{p.summary || 'Nothing in the trip needed changing for that.'}</p>;
  }

  if (p.state === 'applied') {
    const n = Number(p.done) || 0;
    return (
      <div className={`${s.changesNote} ${s.changesDone}`} role="status">
        <Check size={15} aria-hidden="true" />
        <span>
          {`Applied${n === 1 ? '' : ` ${n} changes`}`}
          {p.summary ? `: ${p.summary.replace(/\.$/, '')}.` : '.'}
        </span>
        <Link className={s.changesLink} href={`/trips/${tripId}/itinerary`}>
          Itinerary <ArrowRight size={13} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (p.state === 'discarded') {
    return (
      <p className={`small muted ${s.changesNote} ${s.changesDone} ${s.changesOff}`}>
        <X size={15} aria-hidden="true" />
        <span>Discarded. Nothing was changed.</span>
      </p>
    );
  }

  async function apply() {
    const done = await changes.apply(p);
    if (done != null) onMark(message.id, { state: 'applied', done, at: new Date().toISOString() });
  }

  async function continueReview() {
    const done = await changes.continueReview();
    if (done != null) onMark(message.id, { state: 'applied', done, at: new Date().toISOString() });
  }

  if (changes.placeReview) {
    return (
      <div className={`card ${s.changes}`}>
        <PlaceReview review={changes.placeReview} busy={changes.busy}
          onChoose={changes.choosePlace} onBack={changes.cancelReview} onContinue={continueReview} />
      </div>
    );
  }

  const edits = expandAll(ops, activities).length;
  return (
    <div className={`card ${s.changes}`}>
      {p.summary ? <p className="small muted cmd-summary">{p.summary}</p> : null}
      <ChangeList ops={ops} activities={activities} />
      {changes.error ? <p className="err" role="alert">{changes.error}</p> : null}
      <div className="cmd-actions">
        <span className="tiny dim">
          {edits} change{edits === 1 ? '' : 's'} · nothing saved yet
        </span>
        <button className="btn sm" type="button" disabled={changes.busy}
          onClick={() => onMark(message.id, { state: 'discarded' })}>
          Discard
        </button>
        <button className="btn sm primary" type="button" disabled={changes.busy} onClick={apply}>
          {changes.busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Apply
        </button>
      </div>
    </div>
  );
}
