/**
 * A plan kept on the server while it is written, so it outlives the tab.
 *
 * Browsers put a tab to sleep when someone switches away, and Edge's sleeping
 * tabs drop its connections: two fourteen-day plans were lost that way on
 * 28 November 2026, at day 5 and at day 12, while the server went on and wrote
 * the whole of each for nobody. So the server saves the plan in plan_drafts
 * as it goes (supabase/migrations/20261128090000_plan_drafts.sql), and the
 * page, when its connection is lost, reads the plan from there rather than
 * paying for it again.
 *
 * Everything here is best-effort. Until the table exists — on production it
 * is created by hand — there is no draft, and the planner works exactly as it
 * did before: the page picks a stopped plan up by asking for the rest.
 */

/** How long a running draft may sit unchanged before the page stops waiting on it. */
export const DRAFT_STALE_MS = 45_000;
/** A draft older than the longest a plan request can live (300 s), and a margin, is dead. */
export const DRAFT_LIFE_MS = 360_000;
export const DRAFT_POLL_MS = 2_500;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Starts a draft for this caller, through their own JWT so row level security
 * holds; resolves to its id, or null when there is nowhere to keep one.
 * Clears the caller's drafts from earlier days on the way.
 */
export async function openDraft(db, { now = Date.now } = {}) {
  if (!db) return null;
  try {
    const { data, error } = await db.from('plan_drafts')
      .insert({ status: 'running', plan: {} }).select('id').single();
    if (error || !data) {
      console.warn('[plan] no draft kept:', (error && error.message) || 'no row');
      return null;
    }
    db.from('plan_drafts').delete()
      .lt('created_at', new Date(now() - DAY_MS).toISOString())
      .then(() => {}, () => {});
    return data.id;
  } catch (e) {
    console.warn('[plan] no draft kept:', e.message);
    return null;
  }
}

/**
 * Writes one draft as the plan grows. `save(plan)` keeps only the latest plan
 * and writes it when the previous write is done, so a slow database never
 * builds a queue; `finish(status, plan)` writes last and resolves when it has.
 *
 * Every write is conditional on the draft still running. When one finds it
 * is not, the traveller pressed Cancel, and `onCancelled` stops the model —
 * a dropped connection and a cancel look the same from here, and only a
 * cancel should stop it.
 */
export function draftWriter(db, id, { onCancelled = () => {}, now = Date.now } = {}) {
  let cancelled = false;
  let latest = null;
  let pumping = null;

  const update = async (fields) => {
    if (cancelled) return;
    try {
      const { data, error } = await db.from('plan_drafts')
        .update({ ...fields, updated_at: new Date(now()).toISOString() })
        .eq('id', id).eq('status', 'running')
        .select('id');
      // A failed write is not a cancel; the next one may land.
      if (error) { console.warn('[plan] draft not saved:', error.message); return; }
      if (!data || !data.length) { cancelled = true; onCancelled(); }
    } catch (e) {
      console.warn('[plan] draft not saved:', e.message);
    }
  };

  const pump = () => {
    if (!pumping) {
      pumping = (async () => {
        while (latest && !cancelled) {
          const plan = latest;
          latest = null;
          // eslint-disable-next-line no-await-in-loop
          await update({ plan });
        }
      })().finally(() => { pumping = null; });
    }
    return pumping;
  };

  return {
    save(plan) { latest = plan; pump(); },
    async finish(status, plan) {
      latest = null;
      if (pumping) await pumping;
      await update(plan ? { status, plan } : { status });
    },
    cancelled: () => cancelled,
  };
}

/**
 * Waits on a draft the page has lost its connection to. `read()` resolves to
 * the row ({ status, plan, updated_at, created_at }) or null, and may throw.
 * `onDraft(plan)` is shown each read, so the days keep appearing.
 *
 * Resolves `{ plan }` once the draft is done, or `{ fallback }` — saying why —
 * as soon as it cannot be: it is missing, stopped or cancelled, has not moved
 * for `staleMs`, or is older than any plan request can live. The page then
 * picks the plan up the old way. Throws only when `signal` aborts.
 */
export async function followDraft({
  read, onDraft = () => {}, signal = null,
  pollMs = DRAFT_POLL_MS, staleMs = DRAFT_STALE_MS, lifeMs = DRAFT_LIFE_MS,
  now = Date.now, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }),
} = {}) {
  let seen = null;
  let seenAt = now();
  for (;;) {
    if (signal && signal.aborted) throw new DOMException('Planning was cancelled.', 'AbortError');
    let row;
    try {
      // eslint-disable-next-line no-await-in-loop
      row = await read();
    } catch (e) {
      if (signal && signal.aborted) throw e;
      return { fallback: 'unreadable' };
    }
    if (!row) return { fallback: 'missing' };
    if (row.plan && typeof row.plan === 'object') onDraft(row.plan);
    if (row.status === 'done') return { plan: row.plan };
    if (row.status !== 'running') return { fallback: row.status || 'missing' };

    // Measured on this clock, not the server's: only whether it moved.
    if (row.updated_at !== seen) { seen = row.updated_at; seenAt = now(); }
    if (now() - seenAt >= staleMs) return { fallback: 'stale' };
    const born = Date.parse(row.created_at || '');
    if (Number.isFinite(born) && now() - born >= lifeMs) return { fallback: 'expired' };
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollMs);
  }
}
