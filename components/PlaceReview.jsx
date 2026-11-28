'use client';
import { Check, Loader2, MapPinOff } from 'lucide-react';
import PlacePhoto from '@/components/PlacePhoto';

/** The answer that keeps a stop's words and gives it no pin. */
export const NO_PLACE = '__none__';

/**
 * The places a stop could be, each with its picture, so the one meant can be
 * recognised rather than told apart by its address. `selected` is the chosen
 * place_id (or NO_PLACE) by item id.
 */
export function PlaceChoices({ items, selected, onChoose }) {
  return items.map((item, i) => (
    <fieldset className="planq" key={item.id}>
      <legend><span>{i + 1}</span>{item.title}</legend>
      <p className="tiny dim place-review-query">Requested location: {item.query}</p>
      <div className="place-review-options">
        {item.candidates.map((candidate) => {
          const on = selected[item.id] === candidate.place_id;
          return (
            <button type="button" className={`place-review-option${on ? ' is-on' : ''}`}
              key={candidate.place_id} aria-pressed={on}
              onClick={() => onChoose(item.id, candidate.place_id)}>
              <PlacePhoto photoRef={candidate.photo_ref} category={item.category || 'other'}
                size={72} alt="" />
              <span>
                <strong>{candidate.name || candidate.label}</strong>
                <small>{candidate.label}</small>
              </span>
            </button>
          );
        })}
        <button type="button"
          className={`place-review-option${selected[item.id] === NO_PLACE ? ' is-on' : ''}`}
          aria-pressed={selected[item.id] === NO_PLACE}
          onClick={() => onChoose(item.id, NO_PLACE)}>
          <PlacePhoto icon={MapPinOff} size={72} />
          <span>
            <strong>None of these</strong>
            <small>Keep the location text without placing a pin.</small>
          </span>
        </button>
      </div>
    </fieldset>
  ));
}

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
        You named {review.items.length === 1 ? 'a place' : 'places'} I found in more than one
        spot. Choose the one you meant before I apply anything.
      </p>
      <PlaceChoices items={review.items} selected={review.selected} onChoose={onChoose} />
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
