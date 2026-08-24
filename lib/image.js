/**
 * Getting a photograph small enough to send.
 *
 * A picture off a phone is eight megapixels and four megabytes, and none of
 * that survives contact with a vision model — it works from a downscaled copy
 * regardless. So the shrinking happens here, before the upload, where it costs
 * one canvas draw and saves several seconds on a hotel connection.
 *
 * 1280px on the long edge is the size at which text in a photographed list is
 * still legible; below that, handwriting starts to go.
 */

const MAX_EDGE = 1280;
const QUALITY = 0.82;

/* What a browser will reliably decode, and what the API accepts. HEIC off an
   iPhone is neither, but Safari converts on the way out of the file picker. */
const OK = /^image\/(jpeg|png|webp|gif)$/;

/** Bigger than this and we do not even try to decode it. */
const MAX_BYTES = 25 * 1024 * 1024;

export class BadImage extends Error {}

function read(file) {
  return new Promise((done, fail) => {
    const fr = new FileReader();
    fr.onload = () => done(String(fr.result || ''));
    fr.onerror = () => fail(new BadImage('That file could not be read.'));
    fr.readAsDataURL(file);
  });
}

function load(url) {
  return new Promise((done, fail) => {
    const img = new Image();
    img.onload = () => done(img);
    img.onerror = () => fail(new BadImage('That file is not an image Wander can read.'));
    img.src = url;
  });
}

/**
 * A file from a picker, a paste or a drop, as a data URL small enough to post.
 *
 * Throws BadImage with something a person can act on. Anything else is a bug
 * and should be allowed to surface as one.
 */
export async function shrink(file) {
  if (!file) throw new BadImage('No picture there.');
  if (!OK.test(file.type || '')) {
    throw new BadImage('That is not an image Wander can read — try a JPEG, PNG or WebP.');
  }
  if (file.size > MAX_BYTES) {
    throw new BadImage('That picture is enormous. Try one under 25 MB.');
  }

  const original = await read(file);
  const img = await load(original);

  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) throw new BadImage('That image appears to be empty.');

  // Already small enough, and already a format the API takes: send it as it is
  // rather than re-encoding a screenshot into something blurrier.
  if (w <= MAX_EDGE && h <= MAX_EDGE && file.type === 'image/jpeg') return original;

  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));

  const ctx = canvas.getContext('2d');
  /* A white ground under it: a PNG screenshot with a transparent background
     becomes black otherwise, which is a hard thing to read words off. */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', QUALITY);
}

/** The first image in a paste or a drop, if there is one. */
export function pickImage(list) {
  const files = Array.from(list || []);
  return files.find((f) => f && OK.test(f.type || '')) || null;
}
