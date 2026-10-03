/*
 * Naming shared by the transit builds: mini-tokyo-3d's English titles for
 * greater Tokyo, made into the names people use there.
 */

import { linePrefixOf, plain } from '../../lib/registry.js';

/*
 * Lines are named as people in Tokyo name them, and as Google Maps does there:
 * the JR lines as JR, the subway lines plain, and the private railways with
 * the company first — "Shinjuku Line" alone is both Toei's and Seibu's. Which
 * companies come first is each operator's `linePrefix` in the registry, found
 * by mini-tokyo-3d's name for it ("JR-East"), one of its aliases there.
 */
export const operatorOfRailway = (railway) => railway.id.split('.')[0];
export function lineName(railway) {
  const title = railway.title.en;
  const company = linePrefixOf(operatorOfRailway(railway));
  return company && !plain(title).includes(plain(company)) ? `${company} ${title}` : title;
}

// What Google calls the vehicle, for the same field on its own routes.
export function vehicle(id) {
  if (/^(TokyoMetro|YokohamaMunicipal)\./.test(id) || /^Toei\.(Asakusa|Mita|Shinjuku|Oedo)$/.test(id)) return 'SUBWAY';
  if (/Monorail/.test(id)) return 'MONORAIL';
  if (/^(Toei\.Arakawa|Tokyu\.Setagaya|UtsunomiyaLightRail\.)/.test(id)) return 'TRAM';
  return 'RAIL';
}
