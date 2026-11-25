'use client';
import { useCallback, useState } from 'react';
import { useTrip } from '@/components/TripProvider';
import { useApp } from '@/components/AppProvider';
import { authHeader } from '@/lib/supabase';
import {
  applyChanges, expandAll, placeTargets, sortPlaces, withChosenPlaces,
} from '@/lib/tripChanges';

/**
 * Applying a proposal someone has approved, from wherever they approved it:
 * the command bar, or a change the Assistant proposed in a chat.
 *
 * New and changed places are looked up first. A sure match is used as it is;
 * several plausible ones stop here (`placeReview`) for the person to choose,
 * and nothing is saved until they have. `apply` and `continueReview` resolve
 * to the number of changes made, or null when nothing was saved (yet).
 */
export default function useTripChanges() {
  const {
    trip, activities, addActivities, saveActivity, moveActivity, deleteActivity, updateTrip,
    appendAgentMessage,
  } = useTrip();
  const { pushToast, fail } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // { plan, expanded, resolved, items, selected } while places await a choice.
  const [placeReview, setPlaceReview] = useState(null);

  /** Write a fully reviewed proposal. No trip mutation happens before this. */
  async function commit(plan, expanded, resolved) {
    setBusy(true); setError('');
    try {
      const done = await applyChanges({
        expanded,
        resolved,
        activities,
        trip,
        api: { addActivities, saveActivity, moveActivity, deleteActivity, updateTrip },
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
   * automatically; plausible alternatives stop here for a human decision.
   */
  async function apply(plan) {
    if (!plan || busy) return null;
    const expanded = expandAll(plan.ops, activities);
    const { targets, destination } = placeTargets(expanded, activities, trip);
    if (!targets.length) return commit(plan, expanded, {});

    setBusy(true); setError('');
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

      const { resolved, uncertain } = sortPlaces(body.results, targets);
      if (uncertain.length) {
        setPlaceReview({
          plan, expanded, resolved, items: uncertain, selected: {},
        });
        return null;
      }
      return await commit(plan, expanded, resolved);
    } catch (e) {
      setError(e.message || 'Could not verify those locations. Nothing was saved.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const choosePlace = useCallback((id, placeId) => {
    setPlaceReview((review) => (review ? {
      ...review, selected: { ...review.selected, [id]: placeId },
    } : review));
  }, []);

  async function continueReview() {
    if (!placeReview) return null;
    const {
      plan, expanded, resolved, items, selected,
    } = placeReview;
    setPlaceReview(null);
    return commit(plan, expanded, withChosenPlaces(resolved, items, selected));
  }

  const cancelReview = useCallback(() => setPlaceReview(null), []);

  /** Back to nothing pending: no choice of places open, no error showing. */
  const reset = useCallback(() => { setPlaceReview(null); setError(''); }, []);

  return {
    busy,
    error,
    placeReview,
    reviewed: placeReview
      ? placeReview.items.every((item) => !!placeReview.selected[item.id]) : false,
    apply,
    choosePlace,
    continueReview,
    cancelReview,
    reset,
  };
}
