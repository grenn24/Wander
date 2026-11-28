'use client';
import { useCallback, useRef, useState } from 'react';
import usePlaceChoice from '@/components/usePlaceChoice';
import { useTrip } from '@/components/TripProvider';
import { useApp } from '@/components/AppProvider';
import { authHeader } from '@/lib/supabase';
import {
  applyChanges, expandAll, placesToLookUp, splitPlaceMatches, withChosenPlaces,
} from '@/lib/tripChanges';

/**
 * Applying a proposal someone has approved, from wherever they approved it:
 * the command bar, or a change the Assistant proposed in a chat.
 *
 * New and changed places are looked up first. A sure match is used as it is;
 * several plausible ones stop here (`placeReview`) for the person to choose,
 * the same pause the planner uses (usePlaceChoice), and nothing is saved
 * until they have. `apply` resolves to the number of changes made once they
 * are saved, or null when nothing was (they went back, or it failed).
 * `continueReview` and `cancelReview` answer the pause; `apply` carries on.
 */
export default function useApplyChanges() {
  const {
    trip, activities, addActivities, saveActivity, moveActivity, deleteActivity, updateTrip,
    appendAgentMessage,
  } = useTrip();
  const { pushToast, fail } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choice = usePlaceChoice();
  /*
   * The trip as it is now. A save can wait on someone choosing a place, and
   * must then use the trip as it is when they finish (a collaborator may have
   * added a stop meanwhile), not as it was when they pressed Apply.
   */
  const now = useRef(null);
  now.current = {
    trip, activities, api: { addActivities, saveActivity, moveActivity, deleteActivity, updateTrip },
  };

  /** Write a fully reviewed proposal. No trip mutation happens before this. */
  async function commit(plan, expanded, resolved) {
    setBusy(true); setError('');
    try {
      const done = await applyChanges({
        expanded,
        resolved,
        activities: now.current.activities,
        trip: now.current.trip,
        api: now.current.api,
      });
      await appendAgentMessage({
        role: 'assistant', kind: 'applied',
        content: `${done} change${done === 1 ? '' : 's'} applied.`,
        meta: { summary: plan.summary, ops: plan.ops },
      });
      pushToast(`${done} change${done === 1 ? '' : 's'} applied.`);
      return done;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Resolve every new or changed place before saving. Certain matches proceed
   * automatically; plausible alternatives wait for a human decision.
   */
  async function apply(plan) {
    if (!plan || busy) return null;
    const expanded = expandAll(plan.ops, activities);
    const { targets, destination } = placesToLookUp(expanded, activities, trip);
    if (!targets.length) return commit(plan, expanded, {});

    setBusy(true); setError('');
    let places;
    try {
      const res = await fetch('/api/places/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({
          items: targets, bias: destination, reviewAmbiguous: true,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not verify those locations.');
      places = splitPlaceMatches(body.results, targets);
    } catch (e) {
      setError(e.message || 'Could not verify those locations. Nothing was saved.');
      return null;
    } finally {
      setBusy(false);
    }

    let { resolved } = places;
    if (places.uncertain.length) {
      const selected = await choice.ask(places.uncertain);
      if (!selected) return null;
      resolved = withChosenPlaces(resolved, places.uncertain, selected);
    }
    return commit(plan, expanded, resolved);
  }

  /** Back to nothing pending: no choice of places open, no error showing. */
  const { cancel } = choice;
  const reset = useCallback(() => { cancel(); setError(''); }, [cancel]);

  return {
    busy,
    error,
    placeReview: choice.review,
    reviewed: choice.ready,
    apply,
    choosePlace: choice.choose,
    continueReview: choice.done,
    cancelReview: choice.cancel,
    reset,
  };
}
