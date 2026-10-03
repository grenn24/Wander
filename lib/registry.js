/*
 * The railways the app knows by name, country by country: each operator's
 * English name, its mark and colour, its logo, the fares it publishes; each
 * line's code and colour where its station signs have them; and the
 * discounts for changing between operators. The data is in
 * data/transit/registry/<country>.json, one operator or line to a line:
 *
 *   operators  { id, name, local, aliases?, mark, colour?, group?, badge?,
 *                linePrefix?, parts?, wikidata?, logo?, fares? }
 *   lines      { operator, name, local?, aliases?, code?, colour? }
 *   transfers  { between: [operator, operator], basis, off }
 *
 * and, for the country, its currency, time zone and the name of its
 * stored-value card. An operator is found by any of its names (`name`,
 * `local`, `aliases`: whatever each data source calls it), a line by its
 * operator and any of its names. Logos are fetched into
 * data/transit/registry/logos.json by scripts/transit/operator-logos.mjs.
 *
 * Adding an operator or a line is a line in the country's file; adding a
 * country is a file and an import below.
 */

import JP from '../data/transit/registry/jp.json' with { type: 'json' };
import LOGOS from '../data/transit/registry/logos.json' with { type: 'json' };

const COUNTRIES = [JP];

// Names compared without accents, case or doubled spaces: "Keiō Line" is "keio line".
export const plain = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const operatorByName = new Map();
const operatorByKey = new Map();
const lineByName = new Map();
const countryByCode = new Map();

for (const country of COUNTRIES) {
  const { operators, lines, transfers, ...about } = country;
  countryByCode.set(country.country, about);
  for (const op of operators) {
    const key = `${country.country}/${op.id}`;
    const entry = { ...op, key, country: country.country };
    operatorByKey.set(key, entry);
    for (const name of [op.name, op.local, ...(op.aliases || [])]) {
      if (name && !operatorByName.has(plain(name))) operatorByName.set(plain(name), entry);
    }
  }
  for (const line of lines) {
    const key = `${country.country}/${line.operator}`;
    for (const name of [line.name, line.local, ...(line.aliases || [])]) {
      if (name && !lineByName.has(`${key}|${plain(name)}`)) lineByName.set(`${key}|${plain(name)}`, line);
    }
  }
  for (const t of transfers || []) {
    for (const id of t.between) {
      const op = operatorByKey.get(`${country.country}/${id}`);
      (op.transfers = op.transfers || []).push({ ...t, other: `${country.country}/${t.between.find((x) => x !== id) || id}` });
    }
  }
}

function initials(name) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return name.slice(0, 1);
}

// A line two companies run shows the first one's logo.
function logoOf(op) {
  const own = LOGOS[op.key];
  if (own) return own.file;
  const first = op.parts && LOGOS[`${op.country}/${op.parts[0]}`];
  return first ? first.file : null;
}

/**
 * An operator by any of its names, as a train shows it: { key, name, mark,
 * colour, logo, group, badge }. One the registry does not know keeps the
 * name it was given and its initials; no name, null.
 */
export function operatorOf(name) {
  if (!name) return null;
  const op = operatorByName.get(plain(name));
  if (!op) return { key: null, name, mark: initials(name), colour: '#5A5148', logo: null, group: null, badge: 'round' };
  return {
    key: op.key,
    name: op.name,
    mark: op.mark || initials(op.name),
    colour: op.colour || '#5A5148',
    logo: logoOf(op),
    group: op.group || null,
    badge: op.badge || 'round',
  };
}

/** The registry's whole entry for an operator, by the key operatorOf gives it. */
export const operatorEntry = (key) => (key ? operatorByKey.get(key) || null : null);

/** A line by its operator and any of the names it goes by: { code, colour, ... } or null. */
export function lineOf(operator, ...names) {
  if (!operator || !operator.key) return null;
  for (const name of names) {
    const hit = name && lineByName.get(`${operator.key}|${plain(name)}`);
    if (hit) return hit;
  }
  return null;
}

/** The prefix an operator's lines carry in English ("JR Yamanote Line"), or ''. */
export function linePrefixOf(name) {
  const op = name && operatorByName.get(plain(name));
  return (op && op.linePrefix) || '';
}

/** What changing from one operator to the other takes off a fare paid on `basis`. */
export function transferOff(a, b, basis) {
  const op = operatorEntry(a && a.key);
  if (!op || !b || !b.key) return 0;
  return (op.transfers || []).filter((t) => t.other === b.key && t.basis === basis)
    .reduce((n, t) => n + t.off, 0);
}

/** A country's currency, time zone and card name, by its code ('JP'). */
export const countryOf = (code) => countryByCode.get(code) || null;

/** Every operator's logo credit, for the Terms page. */
export const logoCredits = () => Object.entries(LOGOS).map(([key, l]) => ({ key, operator: operatorByKey.get(key)?.name || key, ...l }));
