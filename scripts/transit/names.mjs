/*
 * Naming shared by the transit builds: mini-tokyo-3d's English titles for
 * greater Tokyo, made into the names people use there.
 */

/*
 * Lines are named as people in Tokyo name them, and as Google Maps does there:
 * the JR lines as JR, the subway lines plain, and the private railways with
 * the company first — "Shinjuku Line" alone is both Toei's and Seibu's.
 */
export const COMPANY = {
  'JR-East': 'JR', 'JR-Central': 'JR', Toei: 'Toei', YokohamaMunicipal: 'Yokohama Subway',
  Keio: 'Keio', Keikyu: 'Keikyu', Keisei: 'Keisei', Tobu: 'Tobu', Seibu: 'Seibu',
  Odakyu: 'Odakyu', Tokyu: 'Tokyu', Sotetsu: 'Sotetsu', TokyoMonorail: 'Tokyo Monorail',
  KantoRailway: 'Kanto Railway', IzuHakone: 'Izuhakone',
};
const plain = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function lineName(railway) {
  const title = railway.title.en;
  const company = COMPANY[railway.id.split('.')[0]];
  return company && !plain(title).includes(plain(company)) ? `${company} ${title}` : title;
}

// What Google calls the vehicle, for the same field on its own routes.
export function vehicle(id) {
  if (/^(TokyoMetro|YokohamaMunicipal)\./.test(id) || /^Toei\.(Asakusa|Mita|Shinjuku|Oedo)$/.test(id)) return 'SUBWAY';
  if (/Monorail/.test(id)) return 'MONORAIL';
  if (/^(Toei\.Arakawa|Tokyu\.Setagaya|UtsunomiyaLightRail\.)/.test(id)) return 'TRAM';
  return 'RAIL';
}
