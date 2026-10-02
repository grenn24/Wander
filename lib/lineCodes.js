/*
 * The letters on a line's station signs (G for the Ginza Line, JY for the
 * Yamanote) and, for lines the data files have no colour for, the line's
 * colour: what its badge shows. Station numbering is public and plain fact;
 * a line not listed here gets a bar in its colour and its name instead.
 *
 * Timetable lines are keyed by the name they carry in the timetables; the
 * nationwide network's by operator and Japanese name, as lib/trainOptions
 * builds their ids.
 */

// Greater Tokyo's timetable, by line name: the code (the colour is in the data).
const TIMETABLE = {
  'JR Yamanote Line': 'JY', 'JR Keihin-Tohoku-Negishi Line': 'JK', 'JR Chuo Rapid Line': 'JC', 'JR Ome Line': 'JC',
  'JR Chuo Sobu Local Line': 'JB', 'JR Saikyo-Kawagoe Line': 'JA', 'JR Shonan-Shinjuku Line': 'JS',
  'JR Tokaido Line': 'JT', 'JR Utsunomiya Line': 'JU', 'JR Takasaki Line': 'JU', 'JR Joban Rapid Line': 'JJ',
  'JR Joban Local Line': 'JL', 'JR Sobu Rapid Line': 'JO', 'JR Yokosuka Line': 'JO', 'JR Keiyo Line': 'JE',
  'JR Musashino Line': 'JM', 'JR Nambu Line': 'JN', 'JR Yokohama Line': 'JH', 'JR Tsurumi Line': 'JI',
  'Ginza Line': 'G', 'Marunouchi Line': 'M', 'Marunouchi Branch Line': 'Mb', 'Hibiya Line': 'H', 'Tozai Line': 'T',
  'Chiyoda Line': 'C', 'Yurakucho Line': 'Y', 'Hanzomon Line': 'Z', 'Namboku Line': 'N', 'Fukutoshin Line': 'F',
  'Toei Asakusa Line': 'A', 'Toei Mita Line': 'I', 'Toei Shinjuku Line': 'S', 'Toei Oedo Line': 'E',
  'Toei Nippori-Toneri Liner': 'NT', 'Toei Tokyo Sakura Tram (Arakawa Line)': 'SA',
  'Yokohama Subway Blue Line': 'B', 'Yokohama Subway Green Line': 'G',
  'Keiō Line': 'KO', 'Keiō New Line': 'KO', 'Keio Sagamihara Line': 'KO', 'Keio Takao Line': 'KO',
  'Keio Keibajō Line': 'KO', 'Keio Dōbutsuen Line': 'KO', 'Keio Inokashira Line': 'IN',
  'Odakyu Odawara Line': 'OH', 'Odakyu Tama Line': 'OT', 'Odakyu Enoshima Line': 'OE',
  'Tokyu Toyoko Line': 'TY', 'Tokyu Den-En-Toshi Line': 'DT', 'Tokyu Meguro Line': 'MG', 'Tokyu Oimachi Line': 'OM',
  'Tokyu Ikegami Line': 'IK', 'Tokyu-Tamagawa Line': 'TM', 'Tokyu Setagaya Line': 'SG', 'Tokyu Kodomonokuni Line': 'KD',
  'Tokyu-Shin-Yokohama Line': 'SH',
  'Seibu Ikebukuro Line': 'SI', 'Seibu Toshima Line': 'SI', 'Seibu Sayama Line': 'SI', 'Seibu-Yurakucho Line': 'SI',
  'Seibu-Chichibu Line': 'SI', 'Seibu Shinjuku Line': 'SS', 'Seibu Haijima Line': 'SS', 'Seibu Kokubunji Line': 'SK',
  'Seibu Tamako Line': 'ST', 'Seibu Tamagawa Line': 'SW', 'Seibu Yamaguchi Line': 'SY',
  'TOBU SKYTREE Line': 'TS', 'Tobu Kameido Line': 'TS', 'Tobu Daishi Line': 'TS', 'Tobu Isesaki Line': 'TI',
  'Tobu Nikko Line': 'TN', 'TOBU URBAN PARK Line': 'TD', 'Tobu Tojo Line': 'TJ', 'Tobu Ogose Line': 'TJ',
  'Keisei Main Line': 'KS', 'Keisei Oshiage Line': 'KS', 'Keisei Higashi-Narita Line': 'KS', 'Keisei Chiba Line': 'KS',
  'Keisei Chihara Line': 'KS', 'Keisei Narita Sky Access Line': 'KS', 'Keisei Kanamachi Line': 'KS',
  'Keisei Matsudo Line': 'KS',
  'Keikyū Main Line': 'KK', 'Keikyu Airport Line': 'KK', 'Keikyu Daishi Line': 'KK', 'Keikyu Zushi Line': 'KK',
  'Keikyu Kurihama Line': 'KK',
  'Sotetsu Main Line': 'SO', 'Sotetsu Izumino Line': 'SO', 'Sotetsu Shin-Yokohama Line': 'SO',
  'Tsukuba Express Line': 'TX', 'Rinkai Line': 'R', 'Yurikamome line': 'U', 'Tokyo Monorail Haneda Airport Line': 'MO',
  'Saitama Railway Line': 'SR', 'Toyo Rapid Line': 'TR', 'Minatomirai Line': 'MM', 'Hokuso Line': 'HS',
  'Tama Monorail Line': 'TT', 'Enoden Line': 'EN',
  // Fukuoka's subway, in the open timetables.
  'Kuko Line': 'K', 'Hakozaki Line': 'H', 'Nanakuma Line': 'N',
};

// The nationwide network, by operator|line: [code, colour].
const MODEL = {
  '東京地下鉄|銀座線': ['G', 'FF9500'], '東京地下鉄|丸ノ内線': ['M', 'F62E36'], '東京地下鉄|丸ノ内線分岐線': ['Mb', 'F62E36'],
  '東京地下鉄|日比谷線': ['H', 'B5B5AC'], '東京地下鉄|東西線': ['T', '009BBF'], '東京地下鉄|千代田線': ['C', '00BB85'],
  '東京地下鉄|有楽町線': ['Y', 'C1A470'], '東京地下鉄|半蔵門線': ['Z', '8F76D6'], '東京地下鉄|南北線': ['N', '00AC9B'],
  '東京地下鉄|副都心線': ['F', '9C5E31'],
  '東京都|浅草線': ['A', 'E85298'], '東京都|三田線': ['I', '0079C2'], '東京都|新宿線': ['S', '6CBB5A'],
  '東京都|大江戸線': ['E', 'B6007A'], '東京都|日暮里・舎人線': ['NT', ''], '東京都|荒川線': ['SA', ''],
  '横浜市|ブルーライン': ['B', '0068B7'], '横浜市|グリーンライン': ['G', '00A33E'],
  '大阪市高速電気軌道|御堂筋線': ['M', 'E5171F'], '大阪市高速電気軌道|谷町線': ['T', '522886'],
  '大阪市高速電気軌道|四つ橋線': ['Y', '0078BA'], '大阪市高速電気軌道|中央線': ['C', '019A66'],
  '大阪市高速電気軌道|千日前線': ['S', 'E44D93'], '大阪市高速電気軌道|堺筋線': ['K', '814721'],
  '大阪市高速電気軌道|長堀鶴見緑地線': ['N', 'A9CC51'], '大阪市高速電気軌道|今里筋線': ['I', 'EE7B1A'],
  '大阪市高速電気軌道|南港ポートタウン線': ['P', '00B2E5'],
  '京都市|烏丸線': ['K', '1E9E4A'], '京都市|東西線': ['T', 'E85D26'],
  '名古屋市|東山線': ['H', 'F2A900'], '名古屋市|名港線': ['E', '7B3E91'], '名古屋市|名港線・名城線': ['M', '7B3E91'],
  '名古屋市|鶴舞線': ['T', '0095D9'], '名古屋市|桜通線': ['S', 'E7001D'], '名古屋市|上飯田線': ['K', 'F287B2'],
  '福岡市|空港線': ['K', 'F7931D'], '福岡市|箱崎線': ['H', '00AEEF'], '福岡市|七隈線': ['N', '009157'],
  '札幌市|南北線': ['N', '009944'], '札幌市|東西線': ['T', 'F07E0F'], '札幌市|東豊線': ['H', '0079C2'],
  '仙台市|南北線': ['N', '009944'], '仙台市|東西線': ['T', '00A0E9'],
  '神戸市|西神・山手線': ['S', ''], '神戸市|海岸線': ['K', ''],
  'JR西日本|東海道線': ['A', '0072BC'], 'JR西日本|大阪環状線': ['O', 'E8392B'], 'JR西日本|福知山線': ['G', 'F7B52C'],
  'JR西日本|JR東西線': ['H', 'E2007E'], 'JR西日本|片町線': ['H', 'E2007E'], 'JR西日本|阪和線': ['R', 'F39800'],
  'JR西日本|関西空港線': ['S', '0072BC'], 'JR西日本|奈良線': ['D', 'A0522D'], 'JR西日本|桜島線': ['P', '2E3192'],
  'JR西日本|おおさか東線': ['F', ''], 'JR西日本|湖西線': ['B', ''], 'JR西日本|草津線': ['C', ''],
};

/** A timetable line's code, or null. */
export const timetableCode = (name) => TIMETABLE[name] || null;

/** A network line's [code, colour] by its id (operator|Japanese name), or [null, ''] where not listed. */
export function modelCode(id) {
  const hit = MODEL[id];
  return hit ? [hit[0] || null, hit[1] || ''] : [null, ''];
}
