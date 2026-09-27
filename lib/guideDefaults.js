import { GUIDES } from './guides.js';
import { fromV1 } from './guideFormat.js';
import { MEDIA } from './guideMedia.js';

/*
 * The hand-written guides as they ship: in the block format, with the
 * photographs and video already chosen and checked for them. Complete wherever
 * they are read — the site's stand-in before the database has anything, and
 * import-defaults — so neither has to search for media again.
 *
 * lib/guideMedia.js is written by `npm run guides -- export-defaults`.
 */

/** What of a guide's media is kept in lib/guideMedia.js. */
export function mediaOf(doc) {
  return {
    cover: doc.cover && doc.cover.photo ? { query: doc.cover.query, photo: doc.cover.photo } : null,
    photos: doc.blocks.filter((b) => b.type === 'photo').map((b) => ({ query: b.query, photos: b.photos || [] })),
    video: doc.video || null,
    rejected: doc.rejected || [],
  };
}

/**
 * Put kept media back on a guide. A photograph goes back only where the
 * search it was found for is unchanged, so editing a guide's text never
 * leaves a picture of the wrong place behind.
 */
export function withMedia(doc, media) {
  if (!media) return doc;
  if (media.cover && doc.cover && media.cover.query === doc.cover.query) doc.cover.photo = media.cover.photo;
  doc.blocks.filter((b) => b.type === 'photo').forEach((b, i) => {
    const kept = (media.photos || [])[i];
    if (kept && kept.query === b.query && kept.photos.length) b.photos = kept.photos;
  });
  if (media.video) doc.video = media.video;
  if (media.rejected && media.rejected.length) doc.rejected = media.rejected;
  return doc;
}

export const defaultDocs = () => GUIDES.map((j) => withMedia(fromV1(j), MEDIA[j.slug]));
