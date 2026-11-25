'use client';
import { Check, Loader2, MapPin } from 'lucide-react';

/**
 * Choosing between places that all plausibly match what an edit asked for,
 * before anything is saved. The same question wherever the edit came from:
 * the command bar or a change the Assistant proposed.
 */
export default function PlaceReview({
  review, busy, onChoose, onBack, onContinue, className = '',
}) {
  const reviewed = review.items.every((item) => !!review.selected[item.id]);
  return (
    <form className={`cmd-plan cmd-place-review ${className}`.trim()}
      onSubmit={(e) => { e.preventDefault(); if (reviewed) onContinue(); }}>
      <p className="small muted cmd-summary">
        I found more than one plausible match. Choose the right place before I apply anything.
      </p>
      {review.items.map((item, i) => (
        <fieldset className="planq" key={item.id}>
          <legend><span>{i + 1}</span>{item.title}</legend>
          <p className="tiny dim place-review-query">Requested location: {item.query}</p>
          <div className="place-review-options">
            {item.candidates.map((candidate) => {
              const selected = review.selected[item.id] === candidate.place_id;
              return (
                <button type="button"
                  className={`place-review-option${selected ? ' is-on' : ''}`}
                  key={candidate.place_id} aria-pressed={selected}
                  onClick={() => onChoose(item.id, candidate.place_id)}>
                  <MapPin size={15} aria-hidden="true" />
                  <span>
                    <strong>{candidate.name || candidate.label}</strong>
                    <small>{candidate.label}</small>
                  </span>
                </button>
              );
            })}
            <button type="button"
              className={`place-review-option${review.selected[item.id] === '__none__' ? ' is-on' : ''}`}
              aria-pressed={review.selected[item.id] === '__none__'}
              onClick={() => onChoose(item.id, '__none__')}>
              <MapPin size={15} aria-hidden="true" />
              <span>
                <strong>None of these</strong>
                <small>Keep the location text without placing a pin.</small>
              </span>
            </button>
          </div>
        </fieldset>
      ))}
      <div className="cmd-actions">
        <span className="tiny dim">Nothing saved yet</span>
        <button className="btn sm" type="button" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button className="btn sm primary" type="submit" disabled={busy || !reviewed}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Apply changes
        </button>
      </div>
    </form>
  );
}
