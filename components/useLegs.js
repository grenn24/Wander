'use client';
import { useEffect, useMemo, useState } from 'react';
import { routeBetween } from '@/lib/geo';
import { prepareCountries, countryAt } from '@/lib/globeRegions';
import {
  TRAVEL_MODES, canRoute, gapCountry, travelOptions, drawnMode,
} from '@/lib/travel';

/*
 * The real way from each stop to the next, from Google, for the trip map and
 * the itinerary — asked for only once the map's Routes setting is on.
 *
 * Each answer costs a call, so each is kept on this device for a fortnight
 * and a hop is paid for once, not every time the page is opened. They are
 * asked a few at a time, not a week's worth in one burst, and never twice at
 * once for the same hop. A way Google cannot route in that country is not
 * asked for at all (see lib/travel).
 */

const STORE = 'wander-legs-v1';
const KEEP_MS = 14 * 24 * 60 * 60 * 1000;
const MOST = 600;

let saved = null;
function stored() {
  if (!saved) {
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { saved = {}; }
  }
  return saved;
}
function recall(key) {
  const hit = stored()[key];
  return hit && Date.now() - hit.at < KEEP_MS ? hit.value : undefined;
}
function keep(key, value) {
  const all = stored();
  all[key] = { at: Date.now(), value };
  const keys = Object.keys(all);
  if (keys.length > MOST) {
    keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MOST).forEach((k) => { delete all[k]; });
  }
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* the session still has it */ }
}

const legKey = (from, to, mode) => `${mode}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;

// Three at a time, and one request per hop however many screens want it.
const asking = new Map();
const waiting = [];
let running = 0;
function pump() {
  while (running < 3 && waiting.length) {
    const next = waiting.shift();
    running += 1;
    next.job().then(next.resolve, next.reject).finally(() => { running -= 1; pump(); });
  }
}
function ask(key, from, to, mode) {
  if (!asking.has(key)) {
    const job = () => routeBetween(from, to, mode);
    asking.set(key, new Promise((resolve, reject) => { waiting.push({ job, resolve, reject }); pump(); })
      .then((answer) => { keep(key, answer); return answer; })
      .finally(() => asking.delete(key)));
  }
  return asking.get(key);
}

// Country borders, fetched the first time routes are wanted: the globe's own file.
let borders = null;
function loadBorders() {
  if (!borders) {
    borders = fetch('/geo/countries-50m.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(prepareCountries)
      .catch(() => { borders = null; return []; });
  }
  return borders;
}

/**
 * hops     [{ key, from: { lat, lng }, to: { lat, lng }, km }]
 * setting  the map's Routes setting: 'off', 'auto', or one way for every hop
 *
 * Returns { on, byKey, gaps }: for each hop its options (see travelOptions) and
 * the way the map draws, and the names of countries on the trip where Google
 * leaves a way out, for saying why some times are estimates.
 */
export default function useLegs(hops, setting) {
  const on = !!setting && setting !== 'off';
  const [countries, setCountries] = useState(null);
  const [answers, setAnswers] = useState({});

  useEffect(() => {
    if (!on || countries) return undefined;
    let live = true;
    loadBorders().then((c) => { if (live) setCountries(c || []); });
    return () => { live = false; };
  }, [on, countries]);

  const countryOf = useMemo(() => {
    const seen = new Map();
    return (point) => {
      if (!countries) return null;
      const key = `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`;
      if (!seen.has(key)) {
        const hit = countries.length ? countryAt(point, countries, 5) : null;
        seen.set(key, hit ? Number(hit.country.id) : null);
      }
      return seen.get(key);
    };
  }, [countries]);

  const signature = hops.map((h) => legKey(h.from, h.to, '')).join('|');
  useEffect(() => {
    if (!on || !countries) return undefined;
    let live = true;
    const found = {};
    hops.forEach((h) => {
      const country = countryOf(h.from);
      TRAVEL_MODES.forEach((mode) => {
        if (!canRoute(country, mode)) return;
        const key = legKey(h.from, h.to, mode);
        if (answers[key] !== undefined) return;
        const kept = recall(key);
        if (kept !== undefined) { found[key] = kept; return; }
        ask(key, h.from, h.to, mode)
          .then((answer) => { if (live) setAnswers((a) => ({ ...a, [key]: answer })); })
          // Not configured, or Google refused: this session goes without, and nothing is kept.
          .catch(() => { if (live) setAnswers((a) => ({ ...a, [key]: { mode, found: false } })); });
      });
    });
    if (Object.keys(found).length) setAnswers((a) => ({ ...a, ...found }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, countries, signature]);

  return useMemo(() => {
    const byKey = {};
    const gaps = new Set();
    hops.forEach((h) => {
      if (!on) { byKey[h.key] = { km: h.km, options: [], drawn: null, country: null }; return; }
      const country = countryOf(h.from);
      const name = gapCountry(country);
      if (name) gaps.add(name);
      const got = {};
      TRAVEL_MODES.forEach((mode) => {
        const answer = answers[legKey(h.from, h.to, mode)];
        if (answer !== undefined) got[mode] = answer;
      });
      byKey[h.key] = {
        km: h.km,
        country,
        gap: name,
        options: countries ? travelOptions(h.km, country, got)
          : TRAVEL_MODES.map((mode) => ({ mode, minutes: null, waiting: true })),
        drawn: drawnMode(setting, h.km, country),
      };
    });
    return { on, byKey, gaps: [...gaps] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, setting, countries, answers, signature]);
}
