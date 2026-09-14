/*
 * Journeys: trips written down as journals rather than schedules.
 *
 * A catalogue itinerary is wrong for everyone who borrows it — their dates,
 * their pace and the people they travel with are all different — so these
 * never pretend to be one. Each journey is the shape of a trip: chapters with a
 * rough length, the moments worth building a day around, and when to go. The
 * planner does the scheduling for the person reading, once they have said what
 * to keep.
 *
 * Seasons are months, never "summer": summer in Queenstown is winter in Kyoto.
 *
 * These are the hand-written journeys, in the original chapter format. They are
 * converted to the block format (lib/journeyFormat.js) wherever they are used:
 * imported into the database by the journey service, and shown directly when
 * the database has no published journeys of its own.
 */

export * from './journeyKit.js';

const RAW = [
  {
    slug: 'kyoto-blossom',
    title: 'Kyoto in blossom week',
    place: 'Kyoto & Nara',
    country: 'Japan',
    region: 'asia',
    center: { lat: 35.0116, lng: 135.7681 },
    months: { best: [3, 4, 11], good: [5, 10], avoid: [7, 8] },
    when: 'Blossom usually peaks in the last days of March or the first week of April. November brings the maples instead.',
    days: [5, 7],
    pace: 'Slow',
    cost: 2,
    mood: ['Gardens', 'Temples', 'Food'],
    teaser: 'Temples at first light, lunch at the market, and a day with the deer in Nara.',
    cover: 'Philosophers Path Kyoto',
    lede: 'Kyoto rewards the early riser. Be at the famous places before the tour buses, and give the afternoons to smaller gardens, long lunches and walking between neighbourhoods. The blossom lasts barely a week, so this is built to bend around the weather.',
    chapters: [
      {
        title: 'The east side, on foot', span: '2 days', where: 'Higashiyama',
        lat: 35.0036, lng: 135.7786,
        body: 'Stay somewhere you can walk from. Climb to Kiyomizu-dera as it opens, drift down the stone lanes below it, and save Maruyama Park for the evening, when the old weeping cherry is lit.',
        moments: [
          { name: 'Kiyomizu-dera', note: 'Go at opening time — the wooden stage is yours for half an hour.' },
          { name: 'Sannenzaka', note: 'Stone lanes and old tea shops, best before nine.' },
          { name: 'Maruyama Park', note: 'The weeping cherry is lit after dark in blossom season.' },
        ],
      },
      {
        title: 'Along the canal', span: '1 day', where: 'Northern Higashiyama',
        lat: 35.0236, lng: 135.794,
        body: 'The Philosopher’s Path follows a cherry-lined canal for about two kilometres. Start at Ginkaku-ji, walk south slowly, and finish at Nanzen-ji, where an old brick aqueduct runs through the temple grounds.',
        moments: [
          { name: 'Ginkaku-ji', note: 'The moss garden and the raked sand are the point, not the pavilion.' },
          { name: 'Philosopher’s Path', q: 'Philosophers Path Kyoto', note: 'Walk it south, before eight if you can.' },
          { name: 'Nanzen-ji', note: 'Find the brick aqueduct behind the main hall.' },
        ],
      },
      {
        title: 'Markets, gates and bamboo', span: '2 days', where: 'Central and western Kyoto',
        lat: 35.005, lng: 135.765,
        body: 'Graze your way down Nishiki Market for lunch. Another day, climb through the gates of Fushimi Inari as far as your legs agree, then take the train west to Arashiyama for the bamboo and a rowing boat on the river.',
        moments: [
          { name: 'Nishiki Market', note: 'Graze rather than sit down; most stalls close by early evening.' },
          { name: 'Fushimi Inari Taisha', note: 'The crowds thin out after the first half hour of climbing.' },
          { name: 'Arashiyama Bamboo Grove', note: 'Arrive early — by mid-morning it is shoulder to shoulder.' },
        ],
      },
      {
        title: 'A day with the deer', span: '1 day', where: 'Nara',
        lat: 34.6851, lng: 135.8048,
        body: 'Nara is under an hour away by train. The deer in the park bow for crackers, the bronze Buddha at Tōdai-ji is bigger than any photograph suggests, and the lantern path to Kasuga Taisha is quiet by late afternoon.',
        moments: [
          { name: 'Nara Park', note: 'Buy the deer crackers only when you are ready. They notice.' },
          { name: 'Tōdai-ji', note: 'Its Great Buddha Hall is one of the largest wooden buildings in the world.' },
          { name: 'Kasuga Taisha', note: 'Thousands of stone lanterns line the forest path.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'Buses crawl in blossom season. Walk, take the subway, or rent a bicycle.' },
      { label: 'Book ahead', text: 'Rooms for blossom week go months in advance.' },
      { label: 'Stay flexible', text: 'Bloom forecasts appear from late winter; keep the middle days movable.' },
    ],
  },
  {
    slug: 'hokkaido-winter',
    title: 'Hokkaido in deep winter',
    place: 'Sapporo, Otaru & Noboribetsu',
    country: 'Japan',
    region: 'asia',
    center: { lat: 43.0618, lng: 141.3545 },
    months: { best: [1, 2], good: [12, 3], avoid: [] },
    when: 'The Sapporo Snow Festival fills a week in early February. January is colder and quieter.',
    days: [5, 7],
    pace: 'Steady',
    cost: 2,
    mood: ['Snow', 'Hot springs', 'Food'],
    teaser: 'Snow sculptures, a lamplit canal, and a hot spring steaming in a volcanic valley.',
    cover: 'Otaru Canal',
    lede: 'Winter is Hokkaido’s best argument. The snow is dry and deep, the food is made for the cold — miso ramen, crab, soup curry — and every day can end in hot water.',
    chapters: [
      {
        title: 'Sapporo under snow', span: '2 days', where: 'Sapporo',
        lat: 43.0618, lng: 141.3545,
        body: 'Stay near Odori Park, where the festival’s biggest sculptures stand. Eat miso ramen in a counter the size of a cupboard, and take the ropeway up Mount Moiwa at dusk for the city lights under snow.',
        moments: [
          { name: 'Odori Park', note: 'The main festival site; the sculptures are lit into the evening.' },
          { name: 'Ganso Ramen Yokocho', note: 'A narrow alley of tiny ramen counters. Order miso.' },
          { name: 'Mount Moiwa Ropeway', note: 'Go just before sunset and stay for the night view.' },
        ],
      },
      {
        title: 'Otaru by lamplight', span: '1 day', where: 'Otaru',
        lat: 43.1907, lng: 140.9947,
        body: 'A short train ride along the coast. The stone warehouses on the canal glow in the evening, the glass and music-box shops are warm places to thaw, and the sushi comes straight off the boats.',
        moments: [
          { name: 'Otaru Canal', note: 'Come back after dark, when the gas lamps are lit.' },
          { name: 'Sakaimachi Street', note: 'Glassworks and music boxes in old merchant houses.' },
          { name: 'Otaru Sushi Street', q: 'Sushiya Dori Otaru', note: 'A street of sushi counters — the lunch sets are the value.' },
        ],
      },
      {
        title: 'Into the hot springs', span: '2 days', where: 'Noboribetsu Onsen',
        lat: 42.496, lng: 141.144,
        body: 'Take the train south and a bus up to Noboribetsu Onsen. Walk the boardwalk through Jigokudani, where the ground steams and bubbles, then spend the evening moving between baths.',
        moments: [
          { name: 'Jigokudani', q: 'Jigokudani Hell Valley Noboribetsu', note: 'Go early, when cold air makes the steam thickest.' },
          { name: 'Oyunumagawa Natural Footbath', note: 'A warm river in the forest, a short walk past the valley.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'Trains run well in snow. Only drive if you have driven on ice.' },
      { label: 'Pack', text: 'Shoes with real grip — the pavements are glazed.' },
      { label: 'Book ahead', text: 'Festival-week hotels fill early.' },
    ],
  },
  {
    slug: 'seoul-autumn',
    title: 'Seoul in autumn colour',
    place: 'Seoul',
    country: 'South Korea',
    region: 'asia',
    center: { lat: 37.5665, lng: 126.978 },
    months: { best: [10, 11], good: [4, 5, 9], avoid: [7, 8] },
    when: 'Late October into November, when the ginkgo streets turn gold and the air is dry.',
    days: [4, 6],
    pace: 'Steady',
    cost: 2,
    mood: ['Palaces', 'Hikes', 'Food'],
    teaser: 'Palaces in hanbok, a city hike to a granite peak, and markets that stay open late.',
    cover: 'Gyeongbokgung Palace',
    lede: 'Seoul is a city poured between mountains. In autumn the ginkgo trees turn gold, the trails fill with people in serious gear going somewhere gentle, and the markets stay open late.',
    chapters: [
      {
        title: 'Palaces and old lanes', span: '2 days', where: 'Jongno',
        lat: 37.5796, lng: 126.977,
        body: 'Start at Gyeongbokgung for the changing of the guard, walk through the hanok houses of Bukchon, and end at Changdeokgung, whose Secret Garden is at its best in autumn. Visitors wearing hanbok get into the palaces free.',
        moments: [
          { name: 'Gyeongbokgung Palace', note: 'Catch the guard ceremony at the main gate.' },
          { name: 'Bukchon Hanok Village', note: 'People live here — keep your voice down.' },
          { name: 'Changdeokgung Secret Garden', q: 'Huwon Secret Garden Changdeokgung', note: 'Entry is by guided tour; book ahead in autumn.' },
        ],
      },
      {
        title: 'Up the city’s mountains', span: '1 day', where: 'Northern Seoul',
        lat: 37.6588, lng: 126.978,
        body: 'Granite peaks ring the city. Climb in Bukhansan National Park, or keep it short on Inwangsan above the palaces, then come down for a long lunch.',
        moments: [
          { name: 'Bukhansan National Park', note: 'Baegundae peak is a half-day climb; start early.' },
          { name: 'Inwangsan', note: 'An hour up, and the whole city below you.' },
        ],
      },
      {
        title: 'Markets and late nights', span: '2 days', where: 'Central Seoul',
        lat: 37.57, lng: 126.999,
        body: 'Eat your way through Gwangjang Market, walk the Cheonggyecheon stream after dark, and give an evening to the cafés and small shops of Seongsu.',
        moments: [
          { name: 'Gwangjang Market', note: 'Mung bean pancakes fried to order. Follow the queues.' },
          { name: 'Cheonggyecheon', note: 'A restored stream through downtown, lovely at night.' },
          { name: 'Seongsu-dong', note: 'Old factories turned into cafés and design shops.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'The subway goes everywhere; one T-money card covers buses and trains.' },
      { label: 'Maps', text: 'Google Maps directions are limited in Korea — use Naver Map or KakaoMap.' },
      { label: 'Book ahead', text: 'Secret Garden tour slots.' },
    ],
  },
  {
    slug: 'vietnam-by-train',
    title: 'Vietnam by train',
    place: 'Hanoi, Huế & Hội An',
    country: 'Vietnam',
    region: 'asia',
    center: { lat: 16.4637, lng: 107.5909 },
    months: { best: [2, 3, 4], good: [1, 5], avoid: [9, 10, 11] },
    when: 'February to April is mild in the north and dry in the centre. Autumn brings storms to the central coast.',
    days: [8, 12],
    pace: 'Steady',
    cost: 1,
    mood: ['Trains', 'Street food', 'History'],
    teaser: 'Street food in Hanoi, an overnight sleeper, the imperial city and a lantern-lit old town.',
    cover: 'Hoi An Ancient Town',
    lede: 'The Reunification Express is slow in the best way. Rice paddies, then the coast, go past the window, and the train sets the pace between three very different cities.',
    chapters: [
      {
        title: 'Hanoi’s old quarter', span: '3 days', where: 'Hanoi',
        lat: 21.0285, lng: 105.8542,
        body: 'Stay in the Old Quarter and do nothing at speed. Walk Hoàn Kiếm Lake at dawn, eat phở at a plastic table, and take a day out to the limestone country of Ninh Bình.',
        moments: [
          { name: 'Hoàn Kiếm Lake', note: 'At dawn the shore is full of people exercising.' },
          { name: 'Temple of Literature', q: 'Temple of Literature Hanoi', note: 'Built in 1070 to honour Confucius; later home to Vietnam’s first university.' },
          { name: 'Tràng An', q: 'Trang An Ninh Binh', note: 'Rowing boats through caves beneath limestone peaks.' },
        ],
      },
      {
        title: 'The night train', span: '1 night', where: 'Hanoi to Huế',
        lat: 21.0245, lng: 105.8412,
        body: 'Take a sleeper berth south. You fall asleep in the north and wake up beside the sea.',
        moments: [
          { name: 'Hanoi Railway Station', note: 'Board in the evening with snacks and water.' },
        ],
      },
      {
        title: 'The imperial city', span: '2 days', where: 'Huế',
        lat: 16.4637, lng: 107.5909,
        body: 'Huế was the seat of the Nguyễn emperors. Walk the walls of the Imperial City, take a boat up the Perfume River to Thiên Mụ Pagoda, and visit a royal tomb in the hills.',
        moments: [
          { name: 'Imperial City', q: 'Imperial City Hue', note: 'Give it a whole morning.' },
          { name: 'Thiên Mụ Pagoda', note: 'A seven-storey tower on the riverbank.' },
          { name: 'Tomb of Khải Định', note: 'Glass and porcelain mosaics inside, a long staircase outside.' },
        ],
      },
      {
        title: 'On to Hội An', span: '3 days', where: 'Hội An',
        lat: 15.8801, lng: 108.338,
        body: 'Take the train along the coast to Đà Nẵng, or a car over the Hải Vân Pass, then on to Hội An. The yellow merchant houses are lit by lanterns at night; the days are for tailors, bicycles and the beach.',
        moments: [
          { name: 'Hải Vân Pass', note: 'The coast road has the views. Stop at the top.' },
          { name: 'Hội An Ancient Town', note: 'Come in the evening, when the lanterns come on.' },
          { name: 'An Bàng Beach', note: 'A short bicycle ride from the old town.' },
        ],
      },
    ],
    know: [
      { label: 'Trains', text: 'Book sleepers ahead. Soft-sleeper cabins sleep four.' },
      { label: 'Money', text: 'Cash is still king at street stalls.' },
      { label: 'Visas', text: 'Check the e-visa rules for your passport before you go.' },
    ],
  },
  {
    slug: 'bali-inland-east',
    title: 'Bali beyond the beach clubs',
    place: 'Ubud & East Bali',
    country: 'Indonesia',
    region: 'asia',
    center: { lat: -8.5069, lng: 115.2625 },
    months: { best: [5, 6, 7, 8, 9], good: [4, 10], avoid: [1, 2] },
    when: 'The dry season runs roughly April to October. July and August are the busiest.',
    days: [6, 9],
    pace: 'Slow',
    cost: 1,
    mood: ['Rice terraces', 'Temples', 'Slow'],
    teaser: 'Rice terraces at sunrise, water palaces in the east, and a quiet coast for snorkelling.',
    cover: 'Tegallalang Rice Terrace',
    lede: 'Most of Bali’s magic is inland and to the east, a long way from the traffic of the south. Go slowly, hire a driver for the long days, and be up at sunrise when the terraces are empty.',
    chapters: [
      {
        title: 'Ubud and the ridges', span: '3 days', where: 'Ubud',
        lat: -8.5069, lng: 115.2625,
        body: 'Walk the Campuhan Ridge in the cool of the morning, see the terraces north of town before the crowds, and spend an afternoon at Tirta Empul, where people bathe in the holy springs.',
        moments: [
          { name: 'Campuhan Ridge Walk', note: 'Start by half past six — it is exposed and hot by nine.' },
          { name: 'Tegallalang Rice Terrace', note: 'Early, before the swings and the crowds.' },
          { name: 'Tirta Empul', note: 'Sarongs are provided at the entrance.' },
        ],
      },
      {
        title: 'Water palaces of the east', span: '2 days', where: 'Karangasem',
        lat: -8.45, lng: 115.61,
        body: 'Take a long day east with a driver: the split gates of Lempuyang, the pools and stepping stones of Tirta Gangga, and the old water palace at Ujung.',
        moments: [
          { name: 'Pura Lempuyang', note: 'The photo queue at the gate can take hours; the climb beyond it is quiet.' },
          { name: 'Tirta Gangga', note: 'A royal water garden with stepping stones over the koi.' },
          { name: 'Taman Ujung', note: 'Grand, spacious and usually empty.' },
        ],
      },
      {
        title: 'Slow days on the coast', span: '3 days', where: 'Amed',
        lat: -8.347, lng: 115.645,
        body: 'Finish in Amed, a string of fishing villages with black-sand beaches and coral close to shore. Snorkel in the morning, sleep in the afternoon, walk to a warung for grilled fish.',
        moments: [
          { name: 'Amed Beach', note: 'The coral starts a short swim from the sand.' },
          { name: 'USAT Liberty Shipwreck', q: 'USAT Liberty Shipwreck Tulamben', note: 'A Second World War wreck in water shallow enough to snorkel.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'Hire a driver by the day for long trips. Scooters are for the confident.' },
      { label: 'Temples', text: 'Cover shoulders and knees; carry a sarong.' },
      { label: 'Water', text: 'Drink bottled or filtered water.' },
    ],
  },
  {
    slug: 'portugal-slow-line',
    title: 'Lisbon to Porto, slowly',
    place: 'Lisbon, Sintra, Coimbra & Porto',
    country: 'Portugal',
    region: 'europe',
    center: { lat: 38.7223, lng: -9.1393 },
    months: { best: [4, 5, 6, 9, 10], good: [3, 11], avoid: [] },
    when: 'Spring and early autumn are warm without the August crowds.',
    days: [7, 10],
    pace: 'Slow',
    cost: 2,
    mood: ['Food', 'Cities', 'Coast'],
    teaser: 'Trams and tiles in Lisbon, palaces in the Sintra hills, port cellars across the river in Porto.',
    cover: 'Alfama Lisbon',
    lede: 'Portugal is best taken slowly: long lunches, late dinners, and a train between two cities that could hardly be more different — sunny, sprawling Lisbon and granite, riverbound Porto.',
    chapters: [
      {
        title: 'Lisbon’s hills', span: '3 days', where: 'Lisbon',
        lat: 38.7223, lng: -9.1393,
        body: 'Lose yourself in Alfama’s stairways, climb to a viewpoint for sunset, and eat custard tarts warm in Belém. Hear fado in a small room rather than a big show.',
        moments: [
          { name: 'Alfama', q: 'Alfama Lisbon', note: 'Put the map away for an afternoon.' },
          { name: 'Miradouro da Senhora do Monte', note: 'The widest sunset view over the city and the castle.' },
          { name: 'Pastéis de Belém', note: 'Warm from the oven. Eat them at the counter.' },
        ],
      },
      {
        title: 'Sintra’s palaces', span: '1 day', where: 'Sintra',
        lat: 38.798, lng: -9.3877,
        body: 'Forty minutes by train from Lisbon. Pena Palace is a painted fantasy on a hilltop; Quinta da Regaleira has a spiral well you can walk down into.',
        moments: [
          { name: 'Pena Palace', note: 'Book a timed ticket and go first thing.' },
          { name: 'Quinta da Regaleira', note: 'The Initiation Well is the reason to come.' },
        ],
      },
      {
        title: 'Coimbra on the way north', span: '1 day', where: 'Coimbra',
        lat: 40.2033, lng: -8.4103,
        body: 'Break the journey in Coimbra, one of Europe’s oldest university towns, for its baroque library and steep old streets.',
        moments: [
          { name: 'Biblioteca Joanina', note: 'Timed entry. Small, gilded and spectacular.' },
          { name: 'University of Coimbra', note: 'The old courtyard looks out over the river.' },
        ],
      },
      {
        title: 'Porto and the river', span: '3 days', where: 'Porto',
        lat: 41.1579, lng: -8.6291,
        body: 'Walk down to the Ribeira waterfront, cross the Dom Luís I bridge on its top deck, and taste port in the lodges of Vila Nova de Gaia. Give a day to the Douro Valley by train.',
        moments: [
          { name: 'Ribeira', q: 'Ribeira Porto', note: 'The riverfront at golden hour.' },
          { name: 'Dom Luís I Bridge', note: 'Walk the upper deck for the view.' },
          { name: 'Douro Valley', q: 'Pinhao Douro Valley', note: 'The line from São Bento to Pinhão follows the river.' },
        ],
      },
    ],
    know: [
      { label: 'Trains', text: 'Lisbon to Porto takes about three hours. Reserve seats.' },
      { label: 'Shoes', text: 'The cobbles are steep and slippery.' },
      { label: 'Eating', text: 'Lunch is the big meal; the prato do dia is the value.' },
    ],
  },
  {
    slug: 'tuscany-hills',
    title: 'Florence and the Tuscan hills',
    place: 'Florence, Siena & the Val d’Orcia',
    country: 'Italy',
    region: 'europe',
    center: { lat: 43.3188, lng: 11.3308 },
    months: { best: [5, 9, 10], good: [4, 6], avoid: [8] },
    when: 'May, and September into October: soft light, open terraces, and the grape harvest.',
    days: [7, 9],
    pace: 'Steady',
    cost: 3,
    mood: ['Art', 'Wine', 'Countryside'],
    teaser: 'Renaissance Florence, medieval Siena, and cypress roads through the Val d’Orcia.',
    cover: 'Val d Orcia cypress',
    lede: 'Give Florence the art and Tuscany the time. The cities are dense and demanding; the hills are for slow drives between hill towns, lunches that become the afternoon, and a room that looks at nothing but vines.',
    chapters: [
      {
        title: 'Florence, for the art', span: '3 days', where: 'Florence',
        lat: 43.7696, lng: 11.2558,
        body: 'Book the Uffizi and the Accademia ahead and go early. Climb the cathedral dome, cross the Ponte Vecchio to the workshops of the Oltrarno, and watch the sun go down from Piazzale Michelangelo.',
        moments: [
          { name: 'Uffizi Gallery', note: 'Timed entry. See the Botticelli rooms before they fill.' },
          { name: 'Brunelleschi’s Dome', q: 'Cupola del Brunelleschi Florence', note: '463 steps to the top. Book a slot.' },
          { name: 'Piazzale Michelangelo', note: 'Walk up for sunset over the whole city.' },
        ],
      },
      {
        title: 'Siena and its square', span: '1 day', where: 'Siena',
        lat: 43.3188, lng: 11.3308,
        body: 'A medieval city built around one extraordinary shell-shaped square. See the striped cathedral, then have a coffee in the Campo as the evening fills it.',
        moments: [
          { name: 'Piazza del Campo', note: 'Twice each summer the Palio horse race tears around it.' },
          { name: 'Siena Cathedral', note: 'The marble floor is only fully uncovered for part of the year.' },
        ],
      },
      {
        title: 'Through the Val d’Orcia', span: '3 days', where: 'Val d’Orcia',
        lat: 43.06, lng: 11.6,
        body: 'Rent a car and stay in a farmhouse. Drive the cypress roads between Pienza and Montalcino, taste Brunello where it is made, and soak in the hot springs at Bagni San Filippo.',
        moments: [
          { name: 'Pienza', note: 'A Renaissance town planned as an ideal. Buy the pecorino.' },
          { name: 'Montalcino', note: 'Brunello, tasted in the town that makes it.' },
          { name: 'Bagni San Filippo', note: 'Free hot springs in the woods over white mineral terraces.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'Trains for the cities, a car for the hills. Never drive into Florence’s restricted centre.' },
      { label: 'Book ahead', text: 'The Uffizi, the Accademia and the dome climb.' },
      { label: 'Hours', text: 'Small shops and restaurants close in the early afternoon.' },
    ],
  },
  {
    slug: 'swiss-alps-rail',
    title: 'The Swiss Alps by train',
    place: 'Lucerne, Lauterbrunnen & Zermatt',
    country: 'Switzerland',
    region: 'europe',
    center: { lat: 46.6863, lng: 7.8632 },
    months: { best: [6, 7, 8, 9], good: [12, 1, 2, 3], avoid: [11] },
    when: 'Summer opens the high trails. Many mountain lifts close for maintenance in November.',
    days: [7, 10],
    pace: 'Full',
    cost: 3,
    mood: ['Mountains', 'Trains', 'Hiking'],
    teaser: 'Lake steamers, a valley of waterfalls, and the Matterhorn at sunrise.',
    cover: 'Lauterbrunnen valley',
    lede: 'Switzerland turns a trip into a timetable in the best way: trains meet boats, boats meet mountain railways, and every connection is on time. It is expensive, so let the views do the work.',
    chapters: [
      {
        title: 'Lucerne and the lake', span: '2 days', where: 'Lucerne',
        lat: 47.0502, lng: 8.3093,
        body: 'Walk the covered Chapel Bridge, take a steamer across the lake, and ride the world’s steepest cogwheel railway up Mount Pilatus.',
        moments: [
          { name: 'Chapel Bridge', q: 'Kapellbrucke Lucerne', note: 'A covered wooden bridge from the fourteenth century.' },
          { name: 'Mount Pilatus', note: 'The cogwheel railway runs in summer only; the cable cars all year.' },
          { name: 'Lake Lucerne', note: 'Paddle steamers leave from beside the station.' },
        ],
      },
      {
        title: 'The valley of waterfalls', span: '3 days', where: 'Lauterbrunnen',
        lat: 46.5935, lng: 7.9091,
        body: 'Seventy-two waterfalls pour into this glacial valley. Stay in car-free Wengen or Mürren, walk between the villages, and on a clear day ride up to the Schilthorn.',
        moments: [
          { name: 'Staubbach Falls', note: 'Almost 300 metres, straight off the cliff above the village.' },
          { name: 'Trümmelbach Falls', note: 'Glacier water thundering inside the mountain. Open in the warmer months.' },
          { name: 'Mürren', note: 'Car-free, facing the Eiger, Mönch and Jungfrau.' },
        ],
      },
      {
        title: 'Zermatt and the Matterhorn', span: '2 days', where: 'Zermatt',
        lat: 46.0207, lng: 7.7491,
        body: 'Zermatt is car-free and sits beneath the Matterhorn. Ride the Gornergrat railway up for the view, and walk the Five Lakes trail to see the mountain reflected.',
        moments: [
          { name: 'Gornergrat Railway', note: 'Take an early train, before the cloud builds.' },
          { name: 'Stellisee', q: 'Stellisee Zermatt', note: 'The lake that mirrors the Matterhorn on a still morning.' },
        ],
      },
    ],
    know: [
      { label: 'Passes', text: 'A Swiss Travel Pass or Half Fare Card often pays for itself. Do the sums for your route.' },
      { label: 'Weather', text: 'Check the summit webcams before paying for a ride up.' },
      { label: 'Luggage', text: 'Swiss railways can send your bags ahead between stations.' },
    ],
  },
  {
    slug: 'iceland-ring-road',
    title: 'Iceland’s Ring Road in summer',
    place: 'Iceland',
    country: 'Iceland',
    region: 'europe',
    center: { lat: 64.9631, lng: -19.0208 },
    months: { best: [6, 7, 8], good: [5, 9], avoid: [12, 1, 2] },
    when: 'June to August: long light, open mountain roads, and puffins on the cliffs.',
    days: [10, 14],
    pace: 'Full',
    cost: 3,
    mood: ['Road trip', 'Waterfalls', 'Wild'],
    teaser: 'Waterfalls, black-sand beaches, a glacier lagoon, and the midnight sun.',
    cover: 'Jokulsarlon glacier lagoon',
    lede: 'Route 1 loops the island in about 1,300 kilometres. In summer the light never quite leaves, so drive while the tour buses sleep, and stop for every waterfall that asks to be photographed.',
    chapters: [
      {
        title: 'The south coast', span: '3 days', where: 'South Iceland',
        lat: 63.5321, lng: -19.5114,
        body: 'Walk behind Seljalandsfoss, climb beside Skógafoss, and watch the surf at Reynisfjara from a safe distance.',
        moments: [
          { name: 'Seljalandsfoss', note: 'Bring a waterproof — the path goes behind the fall.' },
          { name: 'Skógafoss', note: 'Climb the stairs beside it for the trail beyond.' },
          { name: 'Reynisfjara', note: 'Sneaker waves kill people here. Never turn your back on the sea.' },
        ],
      },
      {
        title: 'Glaciers and ice', span: '2 days', where: 'Vatnajökull',
        lat: 64.0784, lng: -16.2306,
        body: 'At Jökulsárlón icebergs drift from the glacier towards the sea and wash up on the black beach across the road. In Skaftafell, walk to a waterfall framed in basalt columns.',
        moments: [
          { name: 'Jökulsárlón', note: 'Seals often swim between the icebergs.' },
          { name: 'Diamond Beach', q: 'Diamond Beach Iceland', note: 'Ice on black sand, best at low sun.' },
          { name: 'Svartifoss', note: 'An uphill walk to black basalt columns.' },
        ],
      },
      {
        title: 'Mývatn’s strange ground', span: '3 days', where: 'Lake Mývatn',
        lat: 65.6039, lng: -16.9961,
        body: 'Take the east fjords slowly, then turn north to Mývatn: lava towers at Dimmuborgir, boiling mud at Hverir, and an evening in the nature baths.',
        moments: [
          { name: 'Dimmuborgir', note: 'Short loops through lava formations.' },
          { name: 'Hverir', note: 'Stay on the marked paths — the ground is boiling.' },
          { name: 'Mývatn Nature Baths', note: 'Warm milky water with the lake below.' },
        ],
      },
      {
        title: 'The north and back west', span: '3 days', where: 'North Iceland',
        lat: 65.6885, lng: -18.1262,
        body: 'Look for whales from Húsavík, stop at Goðafoss, and return towards Reykjavík by the Snæfellsnes peninsula if the days allow.',
        moments: [
          { name: 'Húsavík', note: 'Whale-watching boats run all summer.' },
          { name: 'Goðafoss', note: 'An easy walk on both banks.' },
          { name: 'Kirkjufell', note: 'The mountain and its waterfall on Snæfellsnes.' },
        ],
      },
    ],
    know: [
      { label: 'Driving', text: 'Driving off marked roads is illegal and does lasting damage.' },
      { label: 'Every morning', text: 'Check road.is and safetravel.is before setting off.' },
      { label: 'Book ahead', text: 'Rooms in the east and north are few.' },
    ],
  },
  {
    slug: 'morocco-atlas-sahara',
    title: 'Marrakech, the Atlas and the Sahara',
    place: 'Marrakech to Merzouga',
    country: 'Morocco',
    region: 'africa-me',
    center: { lat: 31.6295, lng: -7.9811 },
    months: { best: [3, 4, 5, 10, 11], good: [2, 12], avoid: [7, 8] },
    when: 'Spring and autumn. Summer in the desert is dangerously hot.',
    days: [7, 9],
    pace: 'Steady',
    cost: 1,
    mood: ['Desert', 'Markets', 'Mountains'],
    teaser: 'The souks of Marrakech, a pass over the High Atlas, and a night among the dunes.',
    cover: 'Jemaa el-Fnaa',
    lede: 'This journey crosses the High Atlas from the red city to the dunes of Erg Chebbi. It is a lot of road, so it is built around nights in places worth waking up in: a riad, a kasbah, a desert camp.',
    chapters: [
      {
        title: 'Marrakech’s medina', span: '3 days', where: 'Marrakech',
        lat: 31.6295, lng: -7.9811,
        body: 'Stay in a riad inside the medina. Get lost in the souks, eat at the stalls of Jemaa el-Fnaa as they set up at dusk, and escape into the cool blue of Jardin Majorelle.',
        moments: [
          { name: 'Jemaa el-Fnaa', note: 'Arrive at dusk as the food stalls go up.' },
          { name: 'Bahia Palace', note: 'Painted ceilings and courtyards. Go at opening.' },
          { name: 'Jardin Majorelle', note: 'Buy a timed ticket online.' },
        ],
      },
      {
        title: 'Over the High Atlas', span: '1 day', where: 'Aït Benhaddou',
        lat: 31.047, lng: -7.1319,
        body: 'Cross the Tizi n’Tichka pass and stop at Aït Benhaddou, an earthen fortified village that has appeared in more films than most actors.',
        moments: [
          { name: 'Tizi n’Tichka', q: 'Tizi n Tichka pass', note: 'Over 2,200 metres. The bends are the view.' },
          { name: 'Aït Benhaddou', note: 'Cross the river and climb to the granary at the top.' },
        ],
      },
      {
        title: 'Gorges and valleys', span: '1 day', where: 'Dadès and Todgha',
        lat: 31.46, lng: -5.97,
        body: 'Follow the road of a thousand kasbahs through the Dadès Valley, then walk between the towering walls of the Todgha Gorge.',
        moments: [
          { name: 'Dadès Gorges', note: 'The switchback road is famous for a reason.' },
          { name: 'Todgha Gorge', note: 'Rock walls rise hundreds of metres on either side.' },
        ],
      },
      {
        title: 'A night in the dunes', span: '2 days', where: 'Merzouga',
        lat: 31.0802, lng: -4.0134,
        body: 'Ride into Erg Chebbi in the late afternoon, climb a dune for sunset, and sleep at a desert camp beneath more stars than you knew there were.',
        moments: [
          { name: 'Erg Chebbi', note: 'Dunes up to 150 metres. Climb one again at sunrise.' },
          { name: 'Merzouga', note: 'Bring warm layers — desert nights are cold.' },
        ],
      },
    ],
    know: [
      { label: 'Getting around', text: 'Hire a driver or join a small group for the crossing. The drive is long.' },
      { label: 'Dress', text: 'Cover shoulders and knees, especially outside Marrakech.' },
      { label: 'Haggling', text: 'Expected in the souks. Smile, and walk away if you need to.' },
    ],
  },
  {
    slug: 'jordan-petra-rum',
    title: 'Petra, Wadi Rum and the Dead Sea',
    place: 'Amman to the Dead Sea',
    country: 'Jordan',
    region: 'africa-me',
    center: { lat: 30.3285, lng: 35.4444 },
    months: { best: [3, 4, 10, 11], good: [5, 9], avoid: [7, 8] },
    when: 'Spring and autumn. Summer at Petra is fierce and almost shadeless.',
    days: [5, 7],
    pace: 'Steady',
    cost: 2,
    mood: ['Ancient sites', 'Desert', 'Hiking'],
    teaser: 'A Roman city, two days in Petra, a Bedouin camp in Wadi Rum, and a float in the Dead Sea.',
    cover: 'Al Khazneh Petra',
    lede: 'Jordan packs a great deal into a small country. Petra deserves two full days, Wadi Rum a night under the sky, and the Dead Sea a lazy last afternoon.',
    chapters: [
      {
        title: 'Amman and Jerash', span: '1 day', where: 'Amman',
        lat: 31.9539, lng: 35.9106,
        body: 'Start at the Citadel above downtown Amman, then drive north to Jerash, one of the best-preserved Roman cities anywhere.',
        moments: [
          { name: 'Amman Citadel', note: 'Look down on the Roman theatre below.' },
          { name: 'Jerash', note: 'Colonnaded streets and a vast oval plaza.' },
        ],
      },
      {
        title: 'Petra, over two days', span: '2 days', where: 'Petra',
        lat: 30.3285, lng: 35.4444,
        body: 'Walk the Siq to the Treasury early on the first day, then climb to the Monastery. On the second, take the steep path to the High Place of Sacrifice. Some evenings the Siq is lit with candles.',
        moments: [
          { name: 'Al-Khazneh', q: 'Al Khazneh Treasury Petra', note: 'Be at the gate at opening to have it nearly to yourself.' },
          { name: 'Ad Deir', q: 'Ad Deir Monastery Petra', note: 'About 800 rock-cut steps, every one worth it.' },
          { name: 'High Place of Sacrifice', note: 'The whole site laid out below you.' },
        ],
      },
      {
        title: 'A night in Wadi Rum', span: '1 day', where: 'Wadi Rum',
        lat: 29.576, lng: 35.42,
        body: 'Take a jeep into a desert of red sand and sandstone mountains, climb a rock arch for sunset, and sleep at a Bedouin camp.',
        moments: [
          { name: 'Wadi Rum Protected Area', note: 'Book a camp that includes the jeep tour.' },
          { name: 'Burdah Rock Bridge', note: 'An arch high on the mountain. The climb needs a guide.' },
        ],
      },
      {
        title: 'Floating at the Dead Sea', span: '1 day', where: 'Dead Sea',
        lat: 31.559, lng: 35.4732,
        body: 'Drive north to the lowest land on earth and float. Stop at Mount Nebo on the way, then watch the sun set over the hills across the water.',
        moments: [
          { name: 'Dead Sea', q: 'Dead Sea Jordan beach', note: 'Do not shave that morning, and keep the water out of your eyes.' },
          { name: 'Mount Nebo', note: 'Where Moses is said to have seen the Promised Land.' },
        ],
      },
    ],
    know: [
      { label: 'Jordan Pass', text: 'Covers the tourist visa and Petra entry if you stay at least three nights.' },
      { label: 'Dress', text: 'Modest clothing; cover shoulders and knees.' },
      { label: 'Water', text: 'Carry plenty in Petra — there is little shade.' },
    ],
  },
  {
    slug: 'peru-sacred-valley',
    title: 'The Sacred Valley and Machu Picchu',
    place: 'Cusco & the Sacred Valley',
    country: 'Peru',
    region: 'americas',
    center: { lat: -13.532, lng: -71.9675 },
    months: { best: [5, 6, 7, 8, 9], good: [4, 10], avoid: [2] },
    when: 'The dry season runs May to September. The Inca Trail closes every February.',
    days: [7, 10],
    pace: 'Steady',
    cost: 2,
    mood: ['Ruins', 'Mountains', 'Markets'],
    teaser: 'Market towns in the valley, salt pans on a hillside, and Machu Picchu at first light.',
    cover: 'Machu Picchu',
    lede: 'Cusco sits at 3,400 metres, so this journey starts low on purpose. Acclimatise in the gentler Sacred Valley first, reach Machu Picchu in the middle, and save Cusco for when your lungs are ready.',
    chapters: [
      {
        title: 'Down into the valley', span: '3 days', where: 'Sacred Valley',
        lat: -13.3047, lng: -72.1156,
        body: 'Go straight from the airport to the valley, lower and warmer than Cusco. See the terraces above Pisac, the circular terraces of Moray, and the salt pans of Maras.',
        moments: [
          { name: 'Pisac', q: 'Pisac archaeological park', note: 'The market town below, the ruins on the ridge above.' },
          { name: 'Moray', q: 'Moray Inca terraces', note: 'Concentric terraces the Inca may have used to test crops.' },
          { name: 'Salineras de Maras', note: 'Thousands of salt pools stepped down the hillside.' },
        ],
      },
      {
        title: 'Ollantaytambo and the train', span: '1 day', where: 'Ollantaytambo',
        lat: -13.2583, lng: -72.2633,
        body: 'A living Inca town with a fortress above it, and the station for the train that follows the river down to Aguas Calientes.',
        moments: [
          { name: 'Ollantaytambo', q: 'Ollantaytambo archaeological site', note: 'The streets below the fortress still follow the Inca plan.' },
        ],
      },
      {
        title: 'Machu Picchu', span: '1 day', where: 'Machu Picchu',
        lat: -13.1631, lng: -72.545,
        body: 'Take one of the first buses up and enter at your timed slot. Tickets are sold by circuit — pick one with the classic viewpoint, and add Huayna Picchu if you want the climb.',
        moments: [
          { name: 'Machu Picchu', note: 'Timed tickets on fixed circuits; book months ahead for the dry season.' },
          { name: 'Huayna Picchu', note: 'A steep climb with a limited number of daily permits.' },
        ],
      },
      {
        title: 'Cusco, slowly', span: '3 days', where: 'Cusco',
        lat: -13.532, lng: -71.9675,
        body: 'Back in Cusco, walk the stones of Qorikancha, where a Spanish convent was built on an Inca temple. Climb to Sacsayhuamán and eat lunch at the San Pedro market.',
        moments: [
          { name: 'Qorikancha', note: 'Inca stonework beneath a colonial convent.' },
          { name: 'Sacsayhuamán', note: 'Walls of enormous fitted stones above the city.' },
          { name: 'San Pedro Market', q: 'Mercado San Pedro Cusco', note: 'Fresh juice and a set lunch at the counter.' },
        ],
      },
    ],
    know: [
      { label: 'Altitude', text: 'Take the first days easy, drink water, and ask a doctor about altitude medicine before you go.' },
      { label: 'Book ahead', text: 'Machu Picchu tickets and trains sell out in the dry season.' },
      { label: 'Pack', text: 'Sunny days, cold nights. Bring layers.' },
    ],
  },
  {
    slug: 'canadian-rockies',
    title: 'The Canadian Rockies',
    place: 'Banff, Lake Louise & Jasper',
    country: 'Canada',
    region: 'americas',
    center: { lat: 51.1784, lng: -115.5708 },
    months: { best: [7, 8, 9], good: [6, 10], avoid: [4, 5, 11] },
    when: 'July to September, when the lakes have thawed to that impossible blue.',
    days: [7, 10],
    pace: 'Full',
    cost: 3,
    mood: ['Lakes', 'Hiking', 'Wildlife'],
    teaser: 'Turquoise lakes, the Icefields Parkway, and elk wandering through Jasper.',
    cover: 'Moraine Lake',
    lede: 'The Icefields Parkway between Lake Louise and Jasper is one of the great drives. The lakes along it are coloured by glacial flour, and they are at their most unreal on a calm, early morning.',
    chapters: [
      {
        title: 'Banff', span: '3 days', where: 'Banff',
        lat: 51.1784, lng: -115.5708,
        body: 'Ride the gondola up Sulphur Mountain, walk the catwalks of Johnston Canyon, soak in the hot springs, and drive the Bow Valley Parkway at dusk for wildlife.',
        moments: [
          { name: 'Banff Gondola', note: 'A boardwalk at the top leads along the ridge to an old weather station.' },
          { name: 'Johnston Canyon', note: 'Catwalks bolted to the canyon wall lead to two waterfalls.' },
          { name: 'Banff Upper Hot Springs', note: 'Best in the evening, after a hike.' },
        ],
      },
      {
        title: 'Lake Louise and Moraine Lake', span: '2 days', where: 'Lake Louise',
        lat: 51.4254, lng: -116.1773,
        body: 'Private cars cannot drive to Moraine Lake — take the Parks Canada shuttle or a commercial bus, and go at sunrise. At Lake Louise, hike up to the tea house above the lake.',
        moments: [
          { name: 'Moraine Lake', note: 'Shuttle or bus only. The Rockpile trail has the famous view.' },
          { name: 'Lake Agnes Tea House', note: 'Tea in a mountain hut an hour or so above Lake Louise.' },
        ],
      },
      {
        title: 'The Icefields Parkway', span: '1 day', where: 'Icefields Parkway',
        lat: 52.22, lng: -117.225,
        body: 'Give the 230-kilometre drive the whole day. Stop at Peyto Lake, walk towards the Athabasca Glacier, and watch for bears from inside the car.',
        moments: [
          { name: 'Peyto Lake', note: 'A short walk to a lake shaped like a wolf’s head.' },
          { name: 'Athabasca Glacier', note: 'Never walk onto the ice without a guide.' },
        ],
      },
      {
        title: 'Jasper', span: '2 days', where: 'Jasper',
        lat: 52.8737, lng: -118.0814,
        body: 'Jasper is quieter and wilder. Take a boat out on Maligne Lake, and stay up for the stars — the park is a dark-sky preserve.',
        moments: [
          { name: 'Maligne Lake', note: 'Boat cruises run out to Spirit Island.' },
          { name: 'Athabasca Falls', note: 'The river forced through a narrow gorge.' },
        ],
      },
    ],
    know: [
      { label: 'Park pass', text: 'You need a Parks Canada pass to stop in the national parks.' },
      { label: 'Wildlife', text: 'Carry bear spray and learn how to use it.' },
      { label: 'Jasper', text: 'Parts of Jasper were burned by wildfire in 2024. Check Parks Canada for trail closures.' },
    ],
  },
  {
    slug: 'nz-south-island',
    title: 'New Zealand’s South Island',
    place: 'Tekapo to Fiordland',
    country: 'New Zealand',
    region: 'oceania',
    center: { lat: -44.5, lng: 169.5 },
    months: { best: [12, 1, 2, 3], good: [11, 4], avoid: [] },
    when: 'December to March is summer: long days and open passes. Lupins line the lakes in early summer.',
    days: [10, 14],
    pace: 'Steady',
    cost: 3,
    mood: ['Road trip', 'Lakes', 'Hiking'],
    teaser: 'Stargazing at Tekapo, a valley walk beneath Aoraki, and a boat into Milford Sound.',
    cover: 'Lake Tekapo',
    lede: 'Drive from the high country to the fiords. Distances look short on the map and are not, so this journey stays a few nights in each place and lets the weather decide the order of the walks.',
    chapters: [
      {
        title: 'Tekapo and the dark sky', span: '2 days', where: 'Lake Tekapo',
        lat: -44.0047, lng: 170.4772,
        body: 'Tekapo sits inside a dark-sky reserve. Visit the little stone church by the lake, and book a stargazing tour for the clearest night.',
        moments: [
          { name: 'Church of the Good Shepherd', q: 'Church of the Good Shepherd Tekapo', note: 'A window behind the altar looks straight at the lake.' },
          { name: 'Mount John Observatory', note: 'Night tours at the top of the hill.' },
        ],
      },
      {
        title: 'Beneath Aoraki', span: '2 days', where: 'Aoraki / Mount Cook',
        lat: -43.734, lng: 170.097,
        body: 'Walk the Hooker Valley over swing bridges to a lake of icebergs below the country’s highest mountain.',
        moments: [
          { name: 'Hooker Valley Track', note: 'About three hours return and mostly flat.' },
          { name: 'Tasman Glacier View', note: 'A short, steep climb to icebergs in the lake.' },
        ],
      },
      {
        title: 'Wānaka and Queenstown', span: '3 days', where: 'Queenstown',
        lat: -45.0312, lng: 168.6626,
        body: 'Wānaka is the calmer lake town, Queenstown the busier. Climb Roys Peak if you are fit, ride the gondola above Queenstown, and drive the lake road to Glenorchy.',
        moments: [
          { name: 'Roys Peak Track', note: 'Long and steep; start before dawn. Closed for lambing each spring.' },
          { name: 'Skyline Queenstown', note: 'The gondola up for the view over Lake Wakatipu.' },
          { name: 'Glenorchy', q: 'Glenorchy New Zealand', note: 'The drive there is the reason to go.' },
        ],
      },
      {
        title: 'Into Fiordland', span: '2 days', where: 'Te Anau',
        lat: -45.4145, lng: 167.718,
        body: 'Stay in Te Anau and take the long road to Milford Sound, stopping at the Mirror Lakes on the way. Go out on a cruise or a kayak beneath the waterfalls.',
        moments: [
          { name: 'Milford Sound', note: 'Rain makes it better — hundreds of waterfalls appear.' },
          { name: 'Mirror Lakes', q: 'Mirror Lakes Fiordland', note: 'A few minutes from the road.' },
        ],
      },
    ],
    know: [
      { label: 'Driving', text: 'Roads are narrow and winding. Allow far longer than the map says.' },
      { label: 'Weather', text: 'It turns fast in the mountains; pack layers and a rain shell.' },
      { label: 'Book ahead', text: 'Milford Sound cruises and summer rooms in Tekapo.' },
    ],
  },
];

export const JOURNEYS = RAW.map((j) => ({
  ...j,
  chapters: j.chapters.map((c, ci) => ({
    ...c,
    moments: c.moments.map((m, mi) => ({ ...m, id: `${ci + 1}.${mi + 1}` })),
  })),
}));

export function journeyBySlug(slug) {
  return JOURNEYS.find((j) => j.slug === slug) || null;
}
