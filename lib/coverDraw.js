/*
 * How a drawn cover is asked for: which model, how large, how well.
 *
 * The size follows the model. gpt-image-1 draws 1536x1024 at most and turns
 * any larger size down, so a bigger default would break every draw for anyone
 * still on it. Its successors draw larger, so once OPENAI_IMAGE_MODEL names one
 * the cover is asked for at 2304x1536 — the same 3:2 shape at 1.5 times the
 * width, sharp across the trip page on a high-density screen and full size in
 * the viewer. A size can also be given outright, in OPENAI_IMAGE_SIZE, to spend
 * more or less; anything that is not WIDTHxHEIGHT is ignored rather than sent.
 *
 * It is drawn at the best quality unless OPENAI_IMAGE_QUALITY says otherwise.
 * That is the other lever on time and money: a large picture at the best
 * quality can take longer than a serverless function is allowed to run, and
 * the way out that needs no deploy is a step down in quality or size.
 *
 * Environment values are trimmed: a space pasted after a model name in a
 * dashboard is otherwise a model that does not exist.
 *
 * Kept apart from the route so it can be checked without a network.
 */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
export const SMALL_COVER_SIZE = '1536x1024';
export const LARGE_COVER_SIZE = '2304x1536';

// gpt-image-1 and its mini share the smaller set of sizes.
const FIRST_GENERATION = /^gpt-image-1(?:$|-)/;
const SIZE = /^\d{3,4}x\d{3,4}$/;
const QUALITIES = ['low', 'medium', 'high', 'auto'];

export function coverDrawing({ model, size, quality } = {}) {
  const name = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_IMAGE_MODEL;
  const asked = typeof size === 'string' ? size.trim().toLowerCase() : '';
  const level = typeof quality === 'string' ? quality.trim().toLowerCase() : '';
  return {
    model: name,
    size: SIZE.test(asked) ? asked : FIRST_GENERATION.test(name) ? SMALL_COVER_SIZE : LARGE_COVER_SIZE,
    quality: QUALITIES.includes(level) ? level : 'high',
  };
}
