/**
 * Waiting for someone to say which place they meant.
 *
 * The place check sometimes finds a place the traveller named in more than
 * one spot (lib/places.js, settlePlace), and then only they can say which.
 * The planner and the apply step behind the command bar and the Assistant
 * both stop there, show the choices, and carry on with the answer. Each used
 * to keep that pause its own way: the planner parked a promise's resolver in
 * a ref, the apply step stored the half-done edit and finished it from a
 * second function. This is the one way, and it reads in order:
 *
 *   const selected = await choice.ask(uncertain);   // null if they went back
 *   if (!selected) return;
 *   resolved = withChosenPlaces(resolved, uncertain, selected);
 *
 * A plain store, so the tests can drive it without React;
 * components/usePlaceChoice.js is the hook the pages use.
 */
export function placeChoice() {
  let state = null; // { items, selected } while a choice is open
  let settle = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const finish = (value) => {
    const resolve = settle;
    settle = null;
    state = null;
    emit();
    if (resolve) resolve(value);
  };
  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Show these choices; resolves with { [item id]: place id }, or null. */
    ask(items) {
      // A newer question replaces one still open, which is answered "back".
      if (settle) finish(null);
      return new Promise((resolve) => {
        settle = resolve;
        state = { items: Array.isArray(items) ? items : [], selected: {} };
        emit();
      });
    },
    choose(id, placeId) {
      if (!state) return;
      state = { ...state, selected: { ...state.selected, [id]: placeId } };
      emit();
    },
    /** Every item has an answer (a place, or "none of these"). */
    ready: () => !!state && state.items.every((item) => !!state.selected[item.id]),
    /** Carry on with what was chosen. */
    done() {
      if (state && settle) finish(state.selected);
    },
    /** Go back without choosing. */
    cancel() {
      finish(null);
    },
  };
}
