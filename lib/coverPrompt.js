/*
 * What a drawn cover is asked to look like.
 *
 * The picture is made from the trip's name and where it goes, and nothing
 * else: no stop, no note, no one on it. The one thing a person may add is the
 * style, and it only ever replaces the look. What is left out stays left out
 * whatever they type, and the trip's own words are cut short so a long name
 * cannot crowd the rest out of the prompt.
 *
 * Kept apart from the route so the wording can be checked without a network.
 */

/** The look a cover has when nobody asks for another. */
export const DEFAULT_COVER_STYLE = 'flat illustration: warm, printed colours, simple shapes';
export const COVER_STYLE_LONGEST = 160;

/** A typed style made fit for a prompt: one line of plain text, or nothing. */
export function tidyCoverStyle(value) {
  if (typeof value !== 'string') return '';
  return value
    // A style is a phrase, not a place to start a new paragraph of instructions.
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
    .slice(0, COVER_STYLE_LONGEST)
    // Cutting can leave a dangling stop, and the prompt supplies its own.
    .replace(/[\s.,;:]+$/, '');
}

/** The prompt for a trip's cover, in the given style or else the default look. */
export function coverPrompt({ name, destination, style } = {}) {
  const look = tidyCoverStyle(style);
  const place = (destination || '').trim();
  return (look
    ? `A travel poster for a trip, in this style: ${look}. No lettering of any kind and no people in the foreground. `
    : `A travel poster for a trip, in ${DEFAULT_COVER_STYLE}, no lettering of any kind and no people in the foreground. `)
    + `The trip is called "${(name || 'A trip').slice(0, 80)}"`
    + `${place ? `, and it goes to ${place.slice(0, 80)}` : ''}. `
    + 'Draw the place, not the words.';
}
