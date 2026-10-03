/*
 * Railway operators as the app names and marks them: an English name, the
 * initials on the mark that stands for the operator's own logo, and the
 * colour behind them. Keyed by the name each data file uses — the Japanese
 * name in the nationwide network, the English one in the timetables.
 *
 * The colours are the operators' own as near as we can tell, darkened where
 * white initials would not read on them. Where Commons has an operator's
 * logo free to use (lib/operatorLogos, scripts/transit/operator-logos.mjs)
 * the mark is that logo instead.
 */

import LOGOS from './operatorLogos.js';

const BY_NAME = {
  JR北海道: ['JR Hokkaido', 'JR', '#2E8B57'],
  JR東日本: ['JR East', 'JR', '#007A03'],
  JR東海: ['JR Central', 'JR', '#C25E00'],
  JR西日本: ['JR West', 'JR', '#0064A8'],
  JR四国: ['JR Shikoku', 'JR', '#007C99'],
  JR九州: ['JR Kyushu', 'JR', '#C8000E'],
  'JR東海・JR西日本': ['JR Central and JR West', 'JR', '#0064A8'],
  'JR東日本・JR北海道': ['JR East and JR Hokkaido', 'JR', '#007A03'],
  'JR東日本・JR西日本': ['JR East and JR West', 'JR', '#007A03'],
  東京地下鉄: ['Tokyo Metro', 'TM', '#0079A8'],
  東京都: ['Toei', 'TO', '#2B7A3B'],
  横浜市: ['Yokohama Subway', 'YS', '#0067A0'],
  名古屋市: ['Nagoya Subway', 'NS', '#A66A00'],
  京都市: ['Kyoto Subway', 'KS', '#007A4D'],
  大阪市高速電気軌道: ['Osaka Metro', 'OM', '#0063B0'],
  神戸市: ['Kobe Subway', 'KB', '#00795A'],
  福岡市: ['Fukuoka Subway', 'FS', '#B5006E'],
  札幌市: ['Sapporo Subway', 'SS', '#007A3D'],
  仙台市: ['Sendai Subway', 'SE', '#00753A'],
  京成電鉄: ['Keisei', 'KS', '#1A4E9A'],
  東武鉄道: ['Tobu', 'TB', '#1F4E9C'],
  西武鉄道: ['Seibu', 'SB', '#1F5FA8'],
  小田急電鉄: ['Odakyu', 'OH', '#1F5FAF'],
  京王電鉄: ['Keio', 'KO', '#B5005A'],
  東急電鉄: ['Tokyu', 'TY', '#B7002A'],
  京浜急行電鉄: ['Keikyu', 'KK', '#C8102E'],
  相模鉄道: ['Sotetsu', 'SO', '#1F4E9C'],
  首都圏新都市鉄道: ['Tsukuba Express', 'TX', '#1F4E9C'],
  東京臨海高速鉄道: ['Rinkai Line', 'R', '#1F5F9F'],
  ゆりかもめ: ['Yurikamome', 'U', '#1F5F9F'],
  東京モノレール: ['Tokyo Monorail', 'MO', '#1F5F9F'],
  名古屋鉄道: ['Meitetsu', 'MT', '#C8102E'],
  近畿日本鉄道: ['Kintetsu', 'KT', '#B5002A'],
  京阪電気鉄道: ['Keihan', 'KH', '#1F5F2F'],
  阪急電鉄: ['Hankyu', 'HK', '#6E1A1A'],
  阪神電気鉄道: ['Hanshin', 'HS', '#1F5FAF'],
  南海電気鉄道: ['Nankai', 'NK', '#C25E00'],
  西日本鉄道: ['Nishitetsu', 'NT', '#B5002A'],
  江ノ島電鉄: ['Enoden', 'EN', '#2E7D32'],
  京福電気鉄道: ['Randen', 'RD', '#6E1A1A'],
  広島電鉄: ['Hiroden', 'HD', '#2E7D32'],
  熊本市: ['Kumamoto City Tram', 'KC', '#2E7D32'],
  とさでん交通: ['Tosaden', 'TD', '#2E7D32'],
  富山地方鉄道: ['Chitetsu', 'CT', '#C8102E'],
  万葉線: ['Manyosen', 'MY', '#0064A8'],
};

// The timetables name lines in English, often with the company first.
const BY_PREFIX = [
  [/^JR /, 'JR東日本'], [/^Toei /, '東京都'], [/^(Tokyo Metro )?(Ginza|Marunouchi|Hibiya|Tozai|Chiyoda|Yurakucho|Hanzomon|Namboku|Fukutoshin) /, '東京地下鉄'],
  [/^Keisei|^Hokuso|^Shibayama/, '京成電鉄'], [/^Tobu|^TOBU/, '東武鉄道'], [/^Seibu/, '西武鉄道'], [/^Odakyu/, '小田急電鉄'],
  [/^Keio|^Keiō/, '京王電鉄'], [/^Tokyu/, '東急電鉄'], [/^Keikyu|^Keikyū/, '京浜急行電鉄'], [/^Sotetsu/, '相模鉄道'],
  [/^Tsukuba Express/, '首都圏新都市鉄道'], [/^Rinkai/, '東京臨海高速鉄道'], [/^Yurikamome/, 'ゆりかもめ'],
  [/^Tokyo Monorail/, '東京モノレール'], [/^Yokohama Subway/, '横浜市'], [/^Enoden/, '江ノ島電鉄'],
  [/^Kuko Line|^Hakozaki Line|^Nanakuma Line/, '福岡市'], [/^Kumamoto City Tram/, '熊本市'], [/^Tosaden/, 'とさでん交通'],
  [/^Toyama|^Toyamakō/, '富山地方鉄道'], [/^Manyōsen/, '万葉線'],
];

// A line two companies run shows the first one's logo.
const logoOf = (name) => {
  const hit = LOGOS[name] || LOGOS[name.split(' and ')[0]];
  return hit ? hit.file : null;
};

/** The operator of a line: { name, mark, colour, logo }, or null where it is not known. */
export function operatorOf({ operator = null, line = '' } = {}) {
  let key = operator && BY_NAME[operator] ? operator : null;
  if (!key && line) {
    const hit = BY_PREFIX.find(([re]) => re.test(line));
    if (hit) key = hit[1];
  }
  if (key) {
    const [name, mark, colour] = BY_NAME[key];
    return { name, mark, colour, logo: logoOf(name) };
  }
  // Known by name only: its initials on a neutral colour.
  if (operator) return { name: operator, mark: initials(operator), colour: '#5A5148', logo: null };
  return null;
}

function initials(name) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return name.slice(0, 1);
}

/** Whether an operator is one of the JR companies, for "JR only" and the square badge. */
export const isJR = (operator) => !!operator && /^JR/.test(operator.name);
