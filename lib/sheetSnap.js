/*
 * Where a sheet settles when the finger lets go.
 *
 * The sizes come in as measured heights, in whatever order the sheet lists
 * them, and what comes back is which of them was meant. Three things decide
 * it: how tall the sheet is now, which way the hand was going, and how fast.
 *
 * Kept apart from the gesture itself because it is only arithmetic, and
 * arithmetic can be checked without a browser or a finger.
 */

// Past this, in pixels per millisecond, a release is a flick: the direction
// says what was meant, not the distance covered.
export const FLICK = 0.5;
// A press that wanders less than this many pixels is a tap.
export const SLOP = 6;
// Heights within this of each other are the same height. A sheet with little
// in it is as tall as its contents at every size it is allowed to be.
const SAME = 2;

/**
 * Held, not broken: past either end the sheet keeps moving, at a third of the
 * hand's pace, so there is somewhere for the gesture to go and nowhere wrong
 * for it to end up.
 */
export function stiffen(wanted, low, high) {
  if (wanted < low) return low - (low - wanted) / 3;
  if (wanted > high) return high + (wanted - high) / 3;
  return wanted;
}

/**
 * Which size the sheet settles at: an index into `heights`.
 *
 * `from` is the height it was at when the drag began, `height` where it ended,
 * `speed` the last pixels per millisecond (positive upwards, so taller), and
 * `moved` whether the press ever became a drag at all.
 */
export function settleOn(heights, { from, height, speed = 0, moved = true }) {
  if (!heights || !heights.length) return 0;
  const order = heights.map((h, i) => i).sort((a, b) => heights[a] - heights[b]);
  const nearest = (h) => order.reduce(
    (best, i) => (Math.abs(heights[i] - h) < Math.abs(heights[best] - h) ? i : best), order[0],
  );

  let at = order.indexOf(nearest(height));
  // With sizes of equal height, the one the hand was heading towards is the
  // one that was meant, rather than whichever was measured first.
  const tied = order.filter((i) => Math.abs(heights[i] - heights[order[at]]) < SAME);
  if (tied.length > 1) at = order.indexOf(height >= from ? tied[tied.length - 1] : tied[0]);

  // A flick carries it one size further the way it was going, unless the drag
  // had already carried it somewhere else.
  if (moved && Math.abs(speed) > FLICK && order.indexOf(nearest(from)) === at) {
    at = Math.min(order.length - 1, Math.max(0, at + (speed > 0 ? 1 : -1)));
  }
  return order[at];
}
