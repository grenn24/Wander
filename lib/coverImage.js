/*
 * A picture someone chose for the head of a trip, made fit to keep.
 *
 * Phone cameras hand over several megabytes at four thousand pixels across; a
 * cover is drawn a few hundred pixels wide in a list. So it is redrawn at a
 * sensible width and encoded once, which is the difference between a cover
 * that appears with the trips and one that arrives after them.
 *
 * The canvas work is handed in, so this can be checked without a browser.
 */
export const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const COVER_INPUT_LIMIT = 30 * 1024 * 1024;
export const COVER_WIDEST = 1600;

/** Something the person can act on, rather than a fault to report. */
export function coverProblem(message) {
  const error = new Error(message);
  error.gentle = true;
  return error;
}

function draw(image, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob((blob) => {
    canvas.width = 0; canvas.height = 0; resolve(blob);
  }, 'image/webp', quality));
}

/** The picture to upload, and the extension its bytes deserve. */
export async function prepareCover(file, runtime = {}) {
  if (!file || !COVER_TYPES.includes(file.type)) throw coverProblem('Choose a JPG, PNG or WebP picture.');
  if (file.size > COVER_INPUT_LIMIT) throw coverProblem('Choose a picture under 30 MB.');
  const decode = runtime.decode || ((blob) => createImageBitmap(blob));
  const render = runtime.encode || draw;
  let image;
  try { image = await decode(file); }
  catch { throw coverProblem('That picture could not be opened. Try another JPG, PNG or WebP.'); }

  const scale = Math.min(1, COVER_WIDEST / Math.max(1, image.width));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const blob = await render(image, width, height, 0.82);
  if (!blob) throw coverProblem('That picture could not be prepared. Try another one.');
  // A browser without a WebP encoder hands back PNG instead; go with what it made.
  const type = blob.type || 'image/webp';
  return { blob, type, extension: type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg' };
}
