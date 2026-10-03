/*
 * Railway operators' logos for the marks beside their names, from Wikimedia
 * Commons: for each operator, the first of a few likely files that exists
 * and is public domain or CC0 — logos made of plain shapes and letters,
 * which Commons files as below the threshold of originality but still
 * someone's trademark, shown here only to say who runs a line. Anything
 * else is left out, and the operator keeps its initials.
 *
 * Writes public/operators/<slug>.svg and lib/operatorLogos.js, the logo
 * and its credit for each operator by the name lib/operators gives it.
 * Commons asks for a slow, named client, so this is one request at a time.
 *
 *   node scripts/transit/operator-logos.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'WanderTripPlanner/1.0 (operator logos with their licences; https://github.com/grenn24/Wander)';
const OPERATORS = {
  'JR East': ['JR logo (east).svg', 'JR East logomark.svg'],
  'JR Central': ['JR logo (central).svg', 'JR Central logomark.svg'],
  'JR West': ['JR logo (west).svg', 'JR West logomark.svg'],
  'JR Hokkaido': ['JR logo (hokkaido).svg'],
  'JR Kyushu': ['JR logo (kyushu).svg', 'JR Kyushu logomark.svg'],
  'JR Shikoku': ['JR logo (shikoku).svg'],
  'Tokyo Metro': ['Tokyo Metro logo.svg', 'TokyoMetro.svg', 'Tokyo Metro logomark.svg'],
  Toei: ['BTTMG logomark.svg', 'Toei Transportation logo.svg'],
  'Osaka Metro': ['Osaka Metro logo.svg'],
  'Yokohama Subway': ['Yokohama Municipal Subway logo.svg'],
  'Kyoto Subway': ['Kyoto Municipal Subway logo.svg'],
  'Nagoya Subway': ['Nagoya Municipal Subway logo.svg'],
  'Sapporo Subway': ['Sapporo Municipal Subway logo.svg'],
  'Fukuoka Subway': ['Fukuoka City Subway logo.svg'],
  Keio: ['Keio logo.svg', 'Keio Corporation logo.svg'],
  Odakyu: ['Odakyu logo.svg', 'Odakyu Group logo.svg'],
  Tokyu: ['Tokyu logo.svg', 'Tokyu Group logo.svg'],
  Seibu: ['Seibu Group logo.svg', 'Seibu logo.svg'],
  Tobu: ['Tobu Railway logo.svg', 'Tobu logo.svg'],
  Keisei: ['Keisei logo.svg', 'Keisei Electric Railway logo.svg'],
  Keikyu: ['Keikyu logo.svg', 'Keikyu Group logo.svg'],
  Sotetsu: ['Sotetsu logo.svg', 'Sotetsu Group logo.svg'],
  'Tsukuba Express': ['Tsukuba Express logo.svg'],
  Kintetsu: ['Kintetsu logo.svg', 'Kintetsu Group logo.svg'],
  Hankyu: ['Hankyu logo.svg'],
  Keihan: ['Keihan logo.svg'],
  Nankai: ['Nankai logo.svg'],
  Hanshin: ['Hanshin logo.svg'],
  Meitetsu: ['Meitetsu logo.svg'],
  Nishitetsu: ['Nishitetsu logo.svg'],
};
const FREE = /^(Public domain|CC0)/i;

/*
 * Logos that come with a slogan or a long name around their mark, cut down to
 * the mark (a viewBox in the file's own units), so that it reads at the 12px
 * it is shown at.
 */
const CROP = {
  Tokyu: [226, 188, 548, 448],
  Keikyu: [-47.34, -47.34, 1278.14, 386.4],
  Keisei: [-11.38, -11.38, 307.39, 161.52],
  'Tsukuba Express': [-3.69, -3.38, 99.65, 52.6],
  Nankai: [-5.07, -5.07, 152.23, 121.54],
};
const crop = (svg, box) => svg.replace(/<svg[\s\S]*?>/, (tag) => tag
  .replace(/\s(width|height|viewBox)="[^"]*"/g, '')
  .replace(/<svg/, `<svg viewBox="${box.join(' ')}"`));

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function get(url, { binary = false } = {}) {
  for (let wait = 4000; wait <= 64000; wait *= 2) {
    const out = execFileSync('curl', ['-sS', '-L', '--max-time', '60', '-H', `User-Agent: ${UA}`, '-w', '\n%{http_code}', url],
      { encoding: binary ? 'latin1' : 'utf8', maxBuffer: 1 << 26 });
    const cut = out.lastIndexOf('\n');
    const status = Number(out.slice(cut + 1));
    if (status === 200) { sleep(2500); return out.slice(0, cut); }
    if (status !== 429 && status < 500) return null;
    console.error(`  ${status}, waiting ${wait / 1000}s`);
    sleep(wait);
  }
  return null;
}

const api = (titles) => JSON.parse(get(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
  action: 'query', format: 'json', prop: 'imageinfo', titles: titles.map((t) => `File:${t}`).join('|'),
  iiprop: 'url|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|Restrictions',
})}`) || '{}');

// Plain shapes and text only: nothing that runs, nothing fetched from elsewhere.
const safe = (svg) => svg.includes('<svg') && !/<script|\son[a-z]+\s*=|javascript:|<foreignObject|xlink:href="(?!#)|href="(?!#)/i.test(svg);

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
mkdirSync(new URL('../../public/operators/', import.meta.url), { recursive: true });
const found = {};
for (const [operator, candidates] of Object.entries(OPERATORS)) {
  const pages = Object.values((api(candidates).query || {}).pages || {});
  const byTitle = new Map(pages.map((p) => [p.title.replace(/^File:/, ''), p]));
  let kept = null;
  for (const title of candidates) {
    const page = byTitle.get(title);
    const info = page && page.imageinfo && page.imageinfo[0];
    if (!info || info.mime !== 'image/svg+xml') continue;
    const licence = (info.extmetadata.LicenseShortName || {}).value || '';
    if (!FREE.test(licence)) { console.log(`  ${operator}: ${title} is ${licence}, left out`); continue; }
    const svg = get(info.url);
    if (!svg || !safe(svg)) { console.log(`  ${operator}: ${title} is not a plain SVG, left out`); continue; }
    const file = `${slug(operator)}.svg`;
    writeFileSync(new URL(`../../public/operators/${file}`, import.meta.url), CROP[operator] ? crop(svg, CROP[operator]) : svg);
    kept = { file: `/operators/${file}`, source: info.descriptionurl, licence };
    break;
  }
  console.log(`${operator}: ${kept ? kept.source : 'none'}`);
  if (kept) found[operator] = kept;
}
writeFileSync(new URL('../../lib/operatorLogos.js', import.meta.url), `${[
  '// Written by scripts/transit/operator-logos.mjs: each operator\'s logo from Wikimedia Commons,',
  '// public domain or CC0, with the page it came from. The trademarks are their owners\'.',
  `export default ${JSON.stringify(found, null, 1)};`,
].join('\n')}\n`);
console.log(`${Object.keys(found).length} of ${Object.keys(OPERATORS).length} operators have a logo.`);
