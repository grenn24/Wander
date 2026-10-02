/*
 * Fits the nationwide model's speeds (PACE in lib/railModel.js) to greater
 * Tokyo, the one place where both the model and real timetables exist.
 *
 * The model knows lines and how often trains run, not which trains are
 * rapid or express, so a fair speed for it is the one that reproduces what
 * people actually get, rapid trains included. This takes a fixed sample of
 * journeys between Tokyo stations, times each by the timetable
 * (lib/timetable) and by the model, and searches for the speeds that make
 * the two agree. Run it after rebuilding either data file, and copy what it
 * prints into PACE.
 *
 *   node scripts/transit/calibrate.mjs
 */
import { readFileSync } from 'node:fs';
import { buildNetwork, typicalJourney, haversineKm } from '../../lib/timetable.js';
import { buildModel, modelJourney, PACE } from '../../lib/railModel.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../data/transit/${name}`, import.meta.url), 'utf8'));
const net = buildNetwork(read('tokyo-rail.json'), 'weekday');
const japan = read('japan-rail.json');

/** The sample: journeys of 2 to 35 km between stations within 35 km of Tokyo Station. */
export function samplePairs(n = 300) {
  let seed = 20261002;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const centre = { lat: 35.6812, lng: 139.7671 };
  const stops = net.stops.filter((s) => s.lat != null && haversineKm(s, centre) < 35);
  const pairs = [];
  while (pairs.length < n) {
    const a = stops[Math.floor(random() * stops.length)];
    const b = stops[Math.floor(random() * stops.length)];
    const km = haversineKm(a, b);
    if (km < 2 || km > 35) continue;
    const truth = typicalJourney(net, a, b);
    if (truth) pairs.push({ a: { lat: a.lat, lng: a.lng }, b: { lat: b.lat, lng: b.lng }, truth: truth.arrives - truth.leaves });
  }
  return pairs;
}

/** How far the model is from the timetable: the mean absolute log ratio, and the median ratio. */
export function score(pairs, pace) {
  const model = buildModel(japan, { pace });
  const ratios = pairs.map(({ a, b, truth }) => {
    const j = modelJourney(model, a, b);
    return j ? j.minutes / truth : 3;
  });
  const error = ratios.reduce((s, r) => s + Math.abs(Math.log(r)), 0) / ratios.length;
  const sorted = [...ratios].sort((x, y) => x - y);
  return { error, median: sorted[Math.floor(sorted.length / 2)] };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const pairs = samplePairs();
  let pace = JSON.parse(JSON.stringify(PACE));
  let best = score(pairs, pace);
  console.log('current', JSON.stringify(pace), best);
  const steps = [['rail', 'kmh', 4], ['rail', 'stop', 0.1], ['subway', 'kmh', 4], ['subway', 'stop', 0.1], [null, 'skip', 0.5]];
  for (let round = 0; round < 6; round += 1) {
    let moved = false;
    for (const [kind, key, step] of steps) {
      for (const dir of [1, -1]) {
        for (;;) {
          const trial = JSON.parse(JSON.stringify(pace));
          const at = kind ? trial[kind] : trial;
          at[key] = Math.round((at[key] + dir * step) * 100) / 100;
          if (at[key] <= 0) break;
          const s = score(pairs, trial);
          if (s.error >= best.error) break;
          pace = trial; best = s; moved = true;
        }
      }
    }
    console.log(`round ${round + 1}`, JSON.stringify(pace), best);
    if (!moved) break;
  }
}
