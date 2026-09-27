// Match explicit destinations only: a stop mentioning an airport or a restaurant
// must not turn a different city's trip into an illustrated destination.
export const CITY_COVERS = [
  { id: 'tokyo', name: 'Tokyo', aliases: ['tokyo', '東京', '东京'],
    story: 'An arrival at Tokyo Station, breakfast by the market, a temple detour and one last look at the skyline.',
    sights: 'Tokyo Station · Tsukiji · Sensō-ji · Tokyo Skytree · Shibuya Crossing · Tokyo Tower' },
  { id: 'shenzhen', name: 'Shenzhen', aliases: ['shenzhen', '深圳'],
    story: 'A morning in the old village, a stroll through the park and a waterfront finish beneath the city lights.',
    sights: 'Dafen Oil Painting Village · Dongmen · Lianhuashan Park · Civic Center · Ping An Finance Centre · Shenzhen Bay' },
  { id: 'kuala-lumpur', name: 'Kuala Lumpur', aliases: ['kuala lumpur', 'kl', '吉隆坡'],
    story: 'Colourful steps, shophouse lanes and a street-food pause before the towers come into view.',
    sights: 'Batu Caves · Merdeka Square · Central Market · Petaling Street · KL Tower · Petronas Twin Towers' },
  { id: 'nagoya', name: 'Nagoya', aliases: ['nagoya', '名古屋'],
    story: 'A castle visit, a little shopping-street adventure and a train waiting for the next chapter.',
    sights: 'Nagoya Castle · Meijō Park · Osu Kannon · Osu shopping streets · Chubu Electric Power MIRAI TOWER · Oasis 21 · Nagoya Station' },
  { id: 'new-york', name: 'New York', aliases: ['new york city', 'new york', 'nyc', '紐約', '纽约'],
    story: 'A harbour arrival, a bridge crossing and a park picnic before the city lights up for the evening.',
    sights: 'Statue of Liberty · Brooklyn Bridge · Empire State Building · Central Park · Grand Central Terminal · Times Square' },
];

export function cityCovers(destination) {
  const text = String(destination || '').normalize('NFKC').toLowerCase();
  return CITY_COVERS.map((city) => {
    let first = Infinity;
    for (const alias of city.aliases) {
      // Bound Latin names so York and KL inside other words never match.
      const expression = /^[a-z]/.test(alias)
        ? new RegExp(`(^|[^\\p{L}\\p{N}])(${alias})(?=$|[^\\p{L}\\p{N}])`, 'u')
        : new RegExp(alias, 'u');
      const match = expression.exec(text);
      if (match) first = Math.min(first, match.index + (match[1]?.length || 0));
    }
    return { city, first };
  }).filter(({ first }) => Number.isFinite(first))
    .sort((a, b) => a.first - b.first).map(({ city }) => city);
}
