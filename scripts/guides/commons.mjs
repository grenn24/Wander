/*
 * Photographs from Wikimedia Commons.
 *
 * Unsplash is a stock library: strong on moods and famous skylines, blank on
 * the terraces above Pisac or a row of fishermen's cabins in Svolvær. Commons
 * is the opposite. Volunteers photograph exactly those places and file them
 * under the place's own name, with coordinates attached, so it is asked
 * whenever Unsplash comes up empty.
 *
 * Every file carries a licence, and only the ones free for any use are taken:
 * public domain, CC0, CC BY and CC BY-SA. NonCommercial and NoDerivatives
 * files are left where they are. Each licence wants the photographer named and
 * the licence itself named beside the picture, so both are stored with it.
 *
 * There is no key and no hourly limit, but Wikimedia asks that a tool say who
 * it is, which is what the user agent below is for.
 */
import { keyWords, queryVariants } from './unsplash.mjs';

const API = 'https://commons.wikimedia.org/w/api.php';
const UA = 'WanderGuides/1.0 (https://github.com/wander-planner) photo search';

export const commonsReady = () => process.env.COMMONS_PHOTOS !== 'off';

async function api(params) {
  const query = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params });
  const res = await fetch(`${API}?${query}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Wikimedia Commons returned ${res.status}`);
  const body = await res.json();
  return ((body.query && body.query.pages) || []).filter((p) => p.imageinfo);
}

const text = (meta, k) => (meta && meta[k] && String(meta[k].value || '')
  .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim()) || '';

/*
 * Licences that allow any use. Commons states each file's licence in a short
 * machine-readable form — "cc-by-sa-4.0", "cc0", "pd" — where "nc" means
 * non-commercial and "nd" means no changes may be made. A photograph shown at
 * several widths is changed, so both are refused, and anything unstated with it.
 */
export function freeToUse(licence) {
  const l = String(licence || '').toLowerCase();
  if (!l || /(^|-)(nc|nd)(-|$)/.test(l)) return false;
  return /^(cc0|cc-by|pd|public\s*domain)/.test(l);
}

/*
 * Files that are not photographs of a place: maps, diagrams, badges, the long
 * thin banners Commons keeps for article headers, and the extreme crops that
 * are usually panoramas stitched for a different purpose.
 */
const NOT_A_PHOTO = /\b(map|diagram|chart|logo|coat of arms|banner|flag|plaque|sign|poster|stamp|seal|graph|sketch|drawing)\b/i;

/*
 * A filename read as a description. Commons names files for cataloguing, so
 * they carry a batch number at the front and the photographer's name at the
 * back; neither belongs in the words a screen reader says aloud.
 */
export function describe(title) {
  return String(title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/^\s*\d{1,4}\s+/, '')
    .replace(/,?\s*(photograph|photo|picture|image)\s+by\s+[^,]*$/i, '')
    .replace(/\s+/g, ' ').trim();
}

export function shape(page) {
  const i = (page.imageinfo || [])[0] || {};
  const meta = i.extmetadata || {};
  const name = describe(page.title);
  return {
    provider: 'commons',
    id: `commons-${page.pageid}`,
    // Wikimedia adds its own tracking to the link; the picture is the same without it.
    raw: String(i.thumburl || '').split('?')[0],
    width: i.width || 0,
    height: i.height || 0,
    color: null,
    alt: name,
    author: text(meta, 'Artist') || 'Wikimedia Commons contributor',
    authorUrl: String(i.descriptionurl || '').split('?')[0],
    pageUrl: String(i.descriptionurl || '').split('?')[0],
    licence: text(meta, 'LicenseShortName') || 'see file page',
    licenceUrl: text(meta, 'LicenseUrl') || '',
    mime: i.mime || '',
    licenceId: text(meta, 'License'),
    categories: text(meta, 'Categories'),
  };
}

/** Whether a file is a photograph at all, and big enough to print large. */
export function usable(f) {
  if (!f.raw || !/^image\/(jpeg|png)$/.test(f.mime)) return false;
  if (!freeToUse(f.licenceId)) return false;
  if (NOT_A_PHOTO.test(f.alt)) return false;
  if (f.width < 1600) return false;
  const ratio = f.width / (f.height || 1);
  return ratio <= 2.2 && ratio >= 0.5;
}

/*
 * How well a photograph suits the frame it would sit in: 2 for the right
 * shape, 1 for one that survives the crop, 0 for one that does not.
 *
 * A tall frame crops a wide photograph to four by five, which a picture with
 * its subject in the middle comes through — the manta rays off Drawaqa are
 * only ever photographed in landscape, and a tall frame would otherwise stay
 * empty. A wide frame cannot do the reverse, so a tall picture never goes in
 * one, and nothing is taken that would lose half its width.
 */
export function fits(f, orientation) {
  const ratio = f.width / (f.height || 1);
  if (orientation === 'portrait') return ratio < 1.05 ? 2 : (ratio <= 1.5 ? 1 : 0);
  return ratio > 1.2 ? 2 : 0;
}

// 1920 is the largest width Wikimedia renders, so links start there and the
// page asks for a smaller one where a smaller one will do.
const IMAGE_INFO = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1920' };

/** Files whose page names the place, as Commons search understands it. */
async function byName(query) {
  return api({ generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20', ...IMAGE_INFO });
}

/** Files photographed within a few hundred metres of a point. */
async function byPlace(lat, lng, radius = 700) {
  return api({ generator: 'geosearch', ggscoord: `${lat}|${lng}`, ggsradius: String(radius), ggsnamespace: '6', ggslimit: '40', ...IMAGE_INFO });
}

/*
 * The place a photo search is about, so its coordinates can be searched too.
 *
 * Names rarely match to the letter: the search says "Wayasewa Island" and the
 * guide's own stop is "Waya Lailai Eco Haven", the same island under the
 * name its lodge uses. So one name matching the start of the other counts,
 * which "waya" and "wayasewa" do, and four letters keeps that from catching
 * everything.
 */
const alike = (a, b) => a === b || (a.length >= 4 && b.startsWith(a)) || (b.length >= 4 && a.startsWith(b));

export function placeFor(doc, query) {
  const words = keyWords(query);
  if (!words.length) return null;
  return (doc.places || []).find((p) => Number.isFinite(p.lat)
    && keyWords(p.name).some((w) => words.some((q) => alike(w, q)))) || null;
}

/*
 * The best photographs Commons has for a search.
 *
 * Where the guide knows the place's coordinates, those are searched first:
 * a photograph filed at that point is of that point, while a name is only a
 * guess. Asked for Fiji's Manta Channel by name, Commons offers a manta ray
 * in Palau's German Channel and a cutter on the Houston Ship Channel, both of
 * which read as a good match and neither of which is in Fiji. Only when a
 * place has no coordinates, or nothing has been photographed there, is the
 * name tried. Bigger pictures win ties, and the right shape beats a bigger
 * one that has to be cropped.
 */
export async function findCommonsPhotos(query, { count = 1, orientation = 'landscape', avoid = new Set(), place = null, log = () => {} } = {}) {
  if (!commonsReady() || !query) return [];
  const found = [];
  const seen = new Set();
  const take = (pages) => {
    for (const page of pages) {
      const f = shape(page);
      if (seen.has(f.id) || avoid.has(f.id) || !usable(f) || !fits(f, orientation)) continue;
      seen.add(f.id);
      found.push(f);
    }
  };
  try {
    if (place) take(await byPlace(place.lat, place.lng));
    for (const q of queryVariants(query)) {
      if (found.length >= count) break;
      take(await byName(q));
    }
  } catch (e) {
    log(`commons: ${e.message}`);
  }
  return found
    .sort((a, b) => (fits(b, orientation) - fits(a, orientation)) || (b.width * b.height - a.width * a.height))
    .slice(0, count)
    .map(({ mime, licenceId, categories, ...m }) => m);
}
