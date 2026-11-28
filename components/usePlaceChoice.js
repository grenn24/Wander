'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { placeChoice } from '@/lib/placeChoice';

/**
 * The pause for "which place did you mean", as a hook (lib/placeChoice.js):
 * `await choice.ask(items)` in the work, and `review`, `ready`, `choose`,
 * `done`, `cancel` for the picker (components/PlaceReview.jsx). Used by the
 * planner and by the apply step the command bar and the Assistant share.
 *
 * A choice still open when the page goes away is answered "back", so the
 * work waiting on it ends rather than hanging.
 */
export default function usePlaceChoice() {
  const [store] = useState(placeChoice);
  const review = useSyncExternalStore(store.subscribe, store.get, () => null);
  useEffect(() => () => store.cancel(), [store]);
  return {
    review,
    ready: !!review && review.items.every((item) => !!review.selected[item.id]),
    ask: store.ask,
    choose: store.choose,
    done: store.done,
    cancel: store.cancel,
  };
}
