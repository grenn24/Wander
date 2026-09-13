export const DESK_IMAGE_LIMIT = 6 * 1024 * 1024;
const TARGET = 2 * 1024 * 1024;
const INPUT_LIMIT = 30 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function animated(file) {
  if (file.type === 'image/gif') return true;
  if (!['image/png', 'image/webp'].includes(file.type)) return false;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  // Walk real chunks, not arbitrary compressed pixel bytes.
  for (let offset = file.type === 'image/png' ? 8 : 12; offset + 8 <= bytes.length;) {
    const png = file.type === 'image/png';
    const typeOffset = offset + (png ? 4 : 0);
    const tag = String.fromCharCode(...bytes.subarray(typeOffset, typeOffset + 4));
    if (tag === 'acTL' || tag === 'ANIM' || tag === 'ANMF') return true;
    const size = view.getUint32(offset + (png ? 0 : 4), !png);
    offset += png ? size + 12 : size + 8 + (size % 2);
  }
  return false;
}

function encode(image, width, height, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image compression is unavailable in this browser.');
  context.drawImage(image, 0, 0, width, height);
  return new Promise(resolve => canvas.toBlob(blob => {
    canvas.width = 0; canvas.height = 0; resolve(blob);
  }, 'image/webp', quality));
}

export async function prepareDeskImage(file, runtime = {}) {
  if (!TYPES.includes(file.type)) throw new Error('Choose a JPG, PNG, WebP or GIF picture.');
  if (file.size <= DESK_IMAGE_LIMIT) return file;
  if (file.size > INPUT_LIMIT) throw new Error('Choose a picture under 30 MB so it can be compressed.');
  if (await animated(file)) throw new Error('Animated pictures must be under 6 MB. Choose a smaller animation or a still image.');
  const decode = runtime.decode || (blob => createImageBitmap(blob));
  const render = runtime.encode || encode;
  let image;
  try { image = await decode(file); }
  catch { throw new Error('This picture could not be opened for compression. Try another JPG, PNG or WebP.'); }
  try {
    let longest = Math.min(2560, Math.max(image.width, image.height));
    let best = null;
    for (let step = 0; step < 4; step += 1) {
      const scale = Math.min(1, longest / Math.max(image.width, image.height));
      for (const quality of [.86, .74]) {
        const blob = await render(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)), quality);
        if (blob && (!best || blob.size < best.size)) best = blob;
        if (best?.size <= TARGET) break;
      }
      if (best?.size <= TARGET) break;
      longest *= .75;
    }
    if (!best || best.size > DESK_IMAGE_LIMIT) throw new Error('This picture could not be reduced below 6 MB. Try a smaller version.');
    // Canvas WebP preserves transparency; a browser without a WebP encoder
    // may return PNG instead, so always use the actual output MIME type.
    const ext = best.type === 'image/webp' ? 'webp' : 'png';
    return new File([best], `${(file.name || 'picture').replace(/\.[^.]+$/, '')}.${ext}`, { type: best.type });
  } finally { image.close?.(); }
}
