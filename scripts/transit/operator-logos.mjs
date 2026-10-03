/*
 * Railway operators' logos for the marks beside their names, for every
 * operator in the registry (data/transit/registry/<country>.json) that has a
 * Wikidata item: the logo Wikidata gives it (P154), or the file its registry
 * entry names instead (`logo`, a Commons file name, where Wikidata's has a
 * slogan or a long name that would not read at 12px), cut to `logoCrop` (a
 * viewBox in the file's units) where that is given.
 *
 * Every file on Wikimedia Commons is free to use under the licence it states;
 * each is kept with that licence, its author and its page, for the Terms
 * page. Logos remain their owners' trademarks and are shown only to say who
 * runs a line. A file that is not a plain SVG (nothing that runs or loads
 * anything) or a small PNG is left out, and the operator keeps its initials.
 *
 * Writes public/operators/<country>/<id>.<svg|png> and
 * data/transit/registry/logos.json. Wikidata's query service and Commons ask
 * for a slow, named client, so it is one request at a time and it waits
 * when told to. Commons serves its original files to scripts only slowly and
 * asks for thumbnails at its standard widths instead, so a logo is a PNG
 * thumbnail tall enough for a sharp 12px mark on any screen, and an SVG only
 * where it is cut to its mark (`logoCrop`).
 *
 *   node scripts/transit/operator-logos.mjs             every country
 *   node scripts/transit/operator-logos.mjs jp           one
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';

const UA = 'WanderTripPlanner/1.0 (operator logos with their licences; https://github.com/grenn24/Wander)';
const root = new URL('../../', import.meta.url);
const registryDir = new URL('data/transit/registry/', root);
const only = process.argv[2] ? process.argv[2].toLowerCase() : null;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function get(url, { binary = false, post = null, accept = null, pace = 1500, patient = false } = {}) {
  // Doubling waits up to 160s; or, for a service that allows a request a minute, a minute at a time for a quarter of an hour.
  const waits = patient ? Array(15).fill(65000) : [5000, 10000, 20000, 40000, 80000, 160000];
  for (const wait of waits) {
    const args = ['-sS', '-L', '--max-time', '90', '-H', `User-Agent: ${UA}`, '-w', '\n%{http_code}'];
    if (accept) args.push('-H', `Accept: ${accept}`);
    if (post) args.push('--data-urlencode', post);
    args.push(url);
    let out;
    try {
      out = execFileSync('curl', args, { encoding: binary ? 'latin1' : 'utf8', maxBuffer: 1 << 26 });
    } catch (e) {
      // A host the network does not allow is not worth waiting for.
      if (/CONNECT tunnel failed, response 40[37]/.test(String(e.stderr || e.message))) return null;
      console.error(`  ${String(e.stderr || e.message).trim().split('\n')[0]}, waiting ${wait / 1000}s`);
      sleep(wait);
      continue;
    }
    const cut = out.lastIndexOf('\n');
    const status = Number(out.slice(cut + 1));
    if (status === 200) { sleep(pace); return out.slice(0, cut); }
    if (status !== 429 && status < 500) return null;
    console.error(`  ${status}, waiting ${wait / 1000}s`);
    sleep(wait);
  }
  return null;
}

// Wikidata's logo for each item: { Q123: 'File name.svg' }.
function wikidataLogos(ids) {
  if (!ids.length) return {};
  const query = `SELECT ?item ?logo WHERE { VALUES ?item { ${ids.map((q) => `wd:${q}`).join(' ')} } ?item wdt:P154 ?logo . }`;
  const body = get('https://query.wikidata.org/sparql', { post: `query=${query}`, accept: 'application/sparql-results+json', pace: 61000, patient: true });
  if (!body) throw new Error('Wikidata did not answer.');
  const out = {};
  for (const r of JSON.parse(body).results.bindings) {
    const q = r.item.value.split('/').pop();
    out[q] = out[q] || decodeURIComponent(r.logo.value.split('/Special:FilePath/')[1]).replace(/_/g, ' ');
  }
  return out;
}

// Commons' file details, fifty at a time: { 'File name.svg': { url, thumb, mime, page, licence, artist } }.
function commonsFiles(names) {
  const out = {};
  for (let i = 0; i < names.length; i += 50) {
    const titles = names.slice(i, i + 50).map((n) => `File:${n}`).join('|');
    const body = get(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
      action: 'query', format: 'json', prop: 'imageinfo', titles,
      iiprop: 'url|mime|size|extmetadata', iiextmetadatafilter: 'LicenseShortName|Artist|UsageTerms',
    })}`);
    if (!body) throw new Error('Commons did not answer.');
    const data = JSON.parse(body).query || {};
    const renamed = Object.fromEntries((data.normalized || []).map((n) => [n.to, n.from]));
    for (const page of Object.values(data.pages || {})) {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) continue;
      const meta = info.extmetadata || {};
      const text = (k) => ((meta[k] || {}).value || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const name = (renamed[page.title] || page.title).replace(/^File:/, '');
      out[name] = {
        url: info.url.replace(/\?.*$/, ''), mime: info.mime, page: info.descriptionurl, width: info.width, height: info.height,
        licence: text('LicenseShortName') || text('UsageTerms'), artist: text('Artist'),
      };
    }
  }
  return out;
}

// Plain shapes and text only: nothing that runs, nothing fetched from elsewhere (inline pictures are fine).
const safe = (svg) => svg.includes('<svg')
  && !/<script|\son[a-z]+\s*=|javascript:|<foreignObject|<iframe|(?:xlink:)?href="(?!#|data:image\/(?:png|jpe?g|gif);base64,)/i.test(svg);
/*
 * A thumbnail at one of Commons' standard widths (https://w.wiki/GHai): the
 * narrowest at which the logo is at least 64px tall, for a 12px mark at up
 * to five times over.
 */
const WIDTHS = [60, 120, 250, 330, 500];
function thumbOf(info) {
  const aspect = info.width && info.height ? info.width / info.height : 1;
  const width = WIDTHS.find((w) => w / aspect >= 64) || WIDTHS[WIDTHS.length - 1];
  if (info.width && info.mime !== 'image/svg+xml' && info.width <= width) return info.url;
  const [, path, file] = /\/commons\/(.+\/)([^/?]+)(\?.*)?$/.exec(info.url);
  const png = /\.png$/i.test(file) ? '' : '.png';
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}${file}/${width}px-${file}${png}`;
}

const crop = (svg, box) => svg.replace(/<svg[\s\S]*?>/, (tag) => tag
  .replace(/\s(width|height|viewBox)="[^"]*"/g, '')
  .replace(/<svg/, `<svg viewBox="${box.join(' ')}"`));

const countries = readdirSync(registryDir).filter((f) => /^[a-z]{2}\.json$/.test(f) && (!only || f === `${only}.json`));
const logosFile = new URL('logos.json', registryDir);
const logos = existsSync(logosFile) ? JSON.parse(readFileSync(logosFile, 'utf8')) : {};
function save() {
  const sorted = Object.entries(logos).sort(([a], [b]) => a.localeCompare(b));
  writeFileSync(logosFile, `{\n${sorted.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}\n`);
}

for (const file of countries) {
  const country = JSON.parse(readFileSync(new URL(file, registryDir), 'utf8'));
  const cc = country.country;
  const dir = new URL(`public/operators/${cc.toLowerCase()}/`, root);
  mkdirSync(dir, { recursive: true });
  const ops = country.operators.filter((o) => o.wikidata || o.logo);
  console.log(`${cc}: ${ops.length} operators to look up`);

  const fromWikidata = wikidataLogos(ops.filter((o) => !o.logo).map((o) => o.wikidata));
  const wanted = new Map(ops.map((o) => [o, o.logo || fromWikidata[o.wikidata]]).filter(([, f]) => f));
  const files = commonsFiles([...new Set(wanted.values())]);

  // A file already here, of the same name and cut, is kept; everything is saved as it comes, so a stopped run resumes.
  const keep = new Set();
  for (const [op, name] of wanted) {
    const info = files[name];
    const key = `${cc}/${op.id}`;
    const had = logos[key];
    const cut = op.logoCrop ? op.logoCrop.join(' ') : null;
    if (had && had.name === name && (had.crop || null) === cut && existsSync(new URL(`public${had.file}`, root))) {
      keep.add(key);
      continue;
    }
    if (!info) { console.log(`  ${op.id}: ${name} not on Commons`); continue; }
    let out = null;
    let ext = null;
    if (op.logoCrop && info.mime === 'image/svg+xml') {
      // Cut to its mark: the drawing itself.
      const svg = get(info.url, { pace: 10000, patient: true });
      if (svg && safe(svg)) { out = crop(svg, op.logoCrop); ext = 'svg'; }
    } else if (/^image\/(svg\+xml|png)$/.test(info.mime)
      && (info.mime === 'image/svg+xml' || /logo|mark|symbol|emblem|ロゴ/i.test(name))) {
      const png = get(thumbOf(info), { binary: true, pace: 3000, patient: true });
      if (png && png.startsWith('\x89PNG')) { out = Buffer.from(png, 'latin1'); ext = 'png'; }
    }
    if (!out) { console.log(`  ${op.id}: ${name} (${info.mime}) left out`); continue; }
    writeFileSync(new URL(`${op.id}.${ext}`, dir), out);
    logos[key] = {
      file: `/operators/${cc.toLowerCase()}/${op.id}.${ext}`,
      name, source: info.page, licence: info.licence || 'see source',
      ...(info.artist ? { artist: info.artist } : {}), ...(cut ? { crop: cut } : {}),
    };
    keep.add(key);
    save();
    console.log(`  ${op.id}: ${name} · ${info.licence}`);
  }
  // What the registry no longer names, or Commons no longer has, goes.
  for (const key of Object.keys(logos)) if (key.startsWith(`${cc}/`) && !keep.has(key)) delete logos[key];
  const used = new Set(Object.values(logos).map((l) => l.file.split('/').pop()));
  for (const f of readdirSync(dir)) if (!used.has(f)) unlinkSync(new URL(f, dir));
  save();
}

console.log(`${Object.keys(logos).length} operators have a logo.`);
