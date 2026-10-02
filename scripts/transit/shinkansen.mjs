/*
 * The Shinkansen, which the nationwide railway data leaves out: it counts
 * only trains that need no ticket beyond the fare, and every Shinkansen
 * does. Nobody publishes their timetables openly either, so this table is
 * written from published journey times, checked against the operators'
 * timetables as quoted by ekitan.com, jr-group.jp and shinkansen.tabiris.com
 * (October 2026), and kept deliberately simple.
 *
 * For each line, in order, each station's
 *
 *   t      minutes after the first station when the fastest train is there
 *          (stopping or passing) — Nozomi, Hayabusa, Kagayaki, Toki, Mizuho
 *   tier   the fastest kind of train that stops: 1 the fastest, 2 the
 *          semi-fast (Hikari, Yamabiko, Hakutaka, Sakura), 3 the all-stations
 *          (Kodama, Nasuno, Tanigawa, Tsubame). A journey goes at the speed of
 *          the fastest train that stops at both ends (lib/railModel).
 *   ph     trains an hour that stop there, either way, in the middle of a weekday
 *
 * Measured anchors, standard (not record) times: Tokyo–Nagoya 1:38,
 * –Kyoto 2:13, –Shin-Osaka 2:27; Shin-Osaka–Okayama 0:51, –Hiroshima 1:26,
 * –Kokura 2:13, –Hakata 2:28; Tokyo–Sendai 1:32, Sendai–Morioka 0:39,
 * Sendai–Shin-Aomori 1:27, Sendai–Shin-Hakodate-Hokuto 2:30; Tokyo–Nagano
 * 1:20, –Toyama 2:07, –Kanazawa 2:27, –Fukui 2:52, –Tsuruga 3:09;
 * Tokyo–Niigata 1:45 stopping; Hakata–Kumamoto 0:32, –Kagoshima-Chuo 1:17;
 * Tokyo–Yamagata 2:38, –Shinjo 3:28; Tokyo–Akita 3:47. Stations between are
 * placed by distance along the line.
 *
 * Positions come from the conventional station of the same name; `lat` and
 * `lng` are given only for the stations that have none, from each station's
 * Japanese Wikipedia article.
 *
 * Revise after each March timetable change, and rebuild with build-japan.mjs.
 */

const s = (ja, en, t, tier, ph, at) => ({ ja, en, t, tier, ph, ...(at ? { lat: at[0], lng: at[1] } : {}) });

export const SHINKANSEN = [
  {
    ja: '東海道・山陽新幹線',
    en: 'Tokaido–Sanyo Shinkansen',
    operator: 'JR東海・JR西日本',
    // Where one named line ends and the next begins, for naming a journey by the line it is on.
    parts: [[16, '東海道新幹線', 'Tokaido Shinkansen'], [34, '山陽新幹線', 'Sanyo Shinkansen']],
    stations: [
      s('東京', 'Tokyo', 0, 1, 12),
      s('品川', 'Shinagawa', 7, 1, 12),
      s('新横浜', 'Shin-Yokohama', 18, 1, 12),
      s('小田原', 'Odawara', 32, 2, 3),
      s('熱海', 'Atami', 37, 3, 2),
      s('三島', 'Mishima', 41, 2, 3),
      s('新富士', 'Shin-Fuji', 47, 3, 2, [35.1420, 138.6634]),
      s('静岡', 'Shizuoka', 55, 2, 3),
      s('掛川', 'Kakegawa', 66, 3, 2),
      s('浜松', 'Hamamatsu', 73, 2, 3),
      s('豊橋', 'Toyohashi', 81, 2, 3),
      s('三河安城', 'Mikawa-Anjo', 91, 3, 2),
      s('名古屋', 'Nagoya', 98, 1, 12),
      s('岐阜羽島', 'Gifu-Hashima', 106, 2, 3, [35.3158, 136.6856]),
      s('米原', 'Maibara', 117, 2, 3),
      s('京都', 'Kyoto', 133, 1, 12),
      s('新大阪', 'Shin-Osaka', 147, 1, 12),
      s('新神戸', 'Shin-Kobe', 161, 1, 6),
      s('西明石', 'Nishi-Akashi', 168, 3, 2),
      s('姫路', 'Himeji', 176, 2, 4),
      s('相生', 'Aioi', 181, 3, 2),
      s('岡山', 'Okayama', 199, 1, 6),
      s('新倉敷', 'Shin-Kurashiki', 205, 3, 2),
      s('福山', 'Fukuyama', 212, 2, 4),
      s('新尾道', 'Shin-Onomichi', 216, 3, 1, [34.4301, 133.1903]),
      s('三原', 'Mihara', 219, 3, 2),
      s('東広島', 'Higashi-Hiroshima', 227, 3, 1, [34.3894, 132.7598]),
      s('広島', 'Hiroshima', 234, 1, 6),
      s('新岩国', 'Shin-Iwakuni', 244, 3, 1, [34.1650, 132.1498]),
      s('徳山', 'Tokuyama', 254, 2, 3),
      s('新山口', 'Shin-Yamaguchi', 264, 2, 3),
      s('厚狭', 'Asa', 271, 3, 1),
      s('新下関', 'Shin-Shimonoseki', 277, 3, 2),
      s('小倉', 'Kokura', 281, 1, 6),
      s('博多', 'Hakata', 296, 1, 6),
    ],
  },
  {
    ja: '東北・北海道新幹線',
    en: 'Tohoku–Hokkaido Shinkansen',
    operator: 'JR東日本・JR北海道',
    parts: [[22, '東北新幹線', 'Tohoku Shinkansen'], [25, '北海道新幹線', 'Hokkaido Shinkansen']],
    stations: [
      s('東京', 'Tokyo', 0, 1, 6),
      s('上野', 'Ueno', 5, 1, 6),
      s('大宮', 'Omiya', 24, 1, 6),
      s('小山', 'Oyama', 35, 3, 1),
      s('宇都宮', 'Utsunomiya', 41, 2, 3),
      s('那須塩原', 'Nasushiobara', 52, 3, 2),
      s('新白河', 'Shin-Shirakawa', 57, 3, 1),
      s('郡山', 'Koriyama', 66, 2, 3),
      s('福島', 'Fukushima', 75, 2, 3),
      s('白石蔵王', 'Shiroishi-Zao', 83, 3, 1, [37.9955, 140.6331]),
      s('仙台', 'Sendai', 92, 1, 4),
      s('古川', 'Furukawa', 102, 2, 2),
      s('くりこま高原', 'Kurikoma-Kogen', 107, 3, 1, [38.7491, 141.0718]),
      s('一ノ関', 'Ichinoseki', 113, 2, 2),
      s('水沢江刺', 'Mizusawa-Esashi', 118, 3, 1, [39.1453, 141.1887]),
      s('北上', 'Kitakami', 122, 2, 2),
      s('新花巻', 'Shin-Hanamaki', 124, 3, 1),
      s('盛岡', 'Morioka', 132, 1, 3),
      s('いわて沼宮内', 'Iwate-Numakunai', 142, 3, 1),
      s('二戸', 'Ninohe', 151, 2, 1),
      s('八戸', 'Hachinohe', 159, 1, 2),
      s('七戸十和田', 'Shichinohe-Towada', 169, 2, 1, [40.7199, 141.1540]),
      s('新青森', 'Shin-Aomori', 180, 1, 2),
      s('奥津軽いまべつ', 'Okutsugaru-Imabetsu', 197, 3, 0.3, [41.1451, 140.5155]),
      s('木古内', 'Kikonai', 228, 3, 0.5),
      s('新函館北斗', 'Shin-Hakodate-Hokuto', 243, 1, 1),
    ],
  },
  {
    ja: '上越新幹線',
    en: 'Joetsu Shinkansen',
    operator: 'JR東日本',
    stations: [
      s('東京', 'Tokyo', 0, 1, 3),
      s('上野', 'Ueno', 5, 1, 3),
      s('大宮', 'Omiya', 24, 1, 3),
      s('熊谷', 'Kumagaya', 34, 3, 1),
      s('本庄早稲田', 'Honjo-Waseda', 40, 3, 1, [36.2188, 139.1795]),
      s('高崎', 'Takasaki', 47, 2, 3),
      s('上毛高原', 'Jomo-Kogen', 60, 3, 1, [36.6932, 138.9776]),
      s('越後湯沢', 'Echigo-Yuzawa', 73, 2, 2),
      s('浦佐', 'Urasa', 81, 3, 1),
      s('長岡', 'Nagaoka', 91, 2, 2),
      s('燕三条', 'Tsubame-Sanjo', 98, 2, 1),
      s('新潟', 'Niigata', 105, 1, 2),
    ],
  },
  {
    ja: '北陸新幹線',
    en: 'Hokuriku Shinkansen',
    operator: 'JR東日本・JR西日本',
    stations: [
      s('東京', 'Tokyo', 0, 1, 3),
      s('上野', 'Ueno', 5, 1, 3),
      s('大宮', 'Omiya', 24, 1, 3),
      s('高崎', 'Takasaki', 46, 2, 2),
      s('安中榛名', 'Annaka-Haruna', 52, 3, 0.5, [36.3624, 138.8496]),
      s('軽井沢', 'Karuizawa', 58, 2, 2),
      s('佐久平', 'Sakudaira', 63, 2, 2),
      s('上田', 'Ueda', 70, 2, 2),
      s('長野', 'Nagano', 80, 1, 3),
      s('飯山', 'Iiyama', 89, 3, 0.5),
      s('上越妙高', 'Joetsu-Myoko', 97, 2, 1),
      s('糸魚川', 'Itoigawa', 107, 3, 0.7),
      s('黒部宇奈月温泉', 'Kurobe-Unazukionsen', 118, 3, 0.7, [36.8740, 137.4811]),
      s('富山', 'Toyama', 127, 1, 2),
      s('新高岡', 'Shin-Takaoka', 134, 2, 1),
      s('金沢', 'Kanazawa', 147, 1, 3),
      s('小松', 'Komatsu', 157, 2, 1.5),
      s('加賀温泉', 'Kaga-Onsen', 162, 2, 1.5),
      s('芦原温泉', 'Awara-Onsen', 166, 3, 1),
      s('福井', 'Fukui', 172, 1, 2),
      s('越前たけふ', 'Echizen-Takefu', 179, 2, 1, [35.8957, 136.1989]),
      s('敦賀', 'Tsuruga', 189, 1, 2),
    ],
  },
  {
    ja: '九州新幹線',
    en: 'Kyushu Shinkansen',
    operator: 'JR九州',
    stations: [
      s('博多', 'Hakata', 0, 1, 3),
      s('新鳥栖', 'Shin-Tosu', 9, 2, 2),
      s('久留米', 'Kurume', 12, 2, 2),
      s('筑後船小屋', 'Chikugo-Funagoya', 17, 3, 1),
      s('新大牟田', 'Shin-Omuta', 22, 3, 1, [33.0713, 130.4888]),
      s('新玉名', 'Shin-Tamana', 27, 3, 1, [32.9425, 130.5736]),
      s('熊本', 'Kumamoto', 32, 1, 3),
      s('新八代', 'Shin-Yatsushiro', 43, 2, 2),
      s('新水俣', 'Shin-Minamata', 53, 3, 1),
      s('出水', 'Izumi', 57, 3, 1),
      s('川内', 'Sendai', 65, 2, 2),
      s('鹿児島中央', 'Kagoshima-Chuo', 77, 1, 2),
    ],
  },
  {
    ja: '西九州新幹線',
    en: 'Nishi-Kyushu Shinkansen',
    operator: 'JR九州',
    stations: [
      s('武雄温泉', 'Takeo-Onsen', 0, 1, 2),
      s('嬉野温泉', 'Ureshino-Onsen', 6, 2, 1.5, [33.1066, 129.9990]),
      s('新大村', 'Shin-Omura', 14, 2, 1.5),
      s('諫早', 'Isahaya', 19, 1, 2),
      s('長崎', 'Nagasaki', 27, 1, 2),
    ],
  },
  {
    ja: '山形新幹線',
    en: 'Yamagata Shinkansen',
    operator: 'JR東日本',
    parts: [[5, '東北新幹線', 'Tohoku Shinkansen'], [15, '山形新幹線', 'Yamagata Shinkansen']],
    stations: [
      s('東京', 'Tokyo', 0, 1, 1),
      s('上野', 'Ueno', 6, 1, 1),
      s('大宮', 'Omiya', 25, 1, 1),
      s('宇都宮', 'Utsunomiya', 47, 2, 1),
      s('郡山', 'Koriyama', 72, 2, 1),
      s('福島', 'Fukushima', 82, 1, 1),
      s('米沢', 'Yonezawa', 121, 1, 1),
      s('高畠', 'Takahata', 131, 2, 0.7),
      s('赤湯', 'Akayu', 137, 1, 1),
      s('かみのやま温泉', 'Kaminoyama-Onsen', 150, 1, 1),
      s('山形', 'Yamagata', 158, 1, 1),
      s('天童', 'Tendo', 170, 2, 0.7),
      s('さくらんぼ東根', 'Sakurambo-Higashine', 176, 2, 0.7),
      s('村山', 'Murayama', 186, 2, 0.7),
      s('大石田', 'Oishida', 194, 2, 0.7),
      s('新庄', 'Shinjo', 208, 1, 0.7),
    ],
  },
  {
    ja: '秋田新幹線',
    en: 'Akita Shinkansen',
    operator: 'JR東日本',
    parts: [[4, '東北新幹線', 'Tohoku Shinkansen'], [9, '秋田新幹線', 'Akita Shinkansen']],
    stations: [
      s('東京', 'Tokyo', 0, 1, 1),
      s('上野', 'Ueno', 6, 1, 1),
      s('大宮', 'Omiya', 25, 1, 1),
      s('仙台', 'Sendai', 92, 1, 1),
      s('盛岡', 'Morioka', 132, 1, 1),
      s('雫石', 'Shizukuishi', 151, 2, 0.5),
      s('田沢湖', 'Tazawako', 165, 1, 1),
      s('角館', 'Kakunodate', 181, 1, 1),
      s('大曲', 'Omagari', 196, 1, 1),
      s('秋田', 'Akita', 227, 1, 1),
    ],
  },
];
