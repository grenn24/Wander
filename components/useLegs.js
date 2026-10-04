'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { routeBetween } from '@/lib/geo';
import { prepareCountries, countryAt } from '@/lib/globeRegions';
import {
  TRAVEL_MODES, canRoute, canAsk, gapCountry, travelOptions, drawnMode, nearOwn, ownModes,
} from '@/lib/travel';

/*
 * The real way from each stop to the next, from Google — or for trains in
 * Japan, from the app's own timetables and railway model — for the trip map
 * and the itinerary. Google's are asked for only once the map's Routes
 * setting is on; the app's own cost nothing and are asked for from the start,
 * so a hop in Japan shows its train lines as soon as the trip opens.
 *
 * Each answer costs a call, so each is kept on this device for a fortnight
 * and a hop is paid for once, not every time the page is opened. They are
 * asked a few at a time, not a week's worth in one burst, and never twice at
 * once for the same hop. A way nothing can route in that country is not
 * asked for at all, and one only the app's timetable might is asked of that
 * alone (see lib/travel).
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

const legKey = (from, to, mode, prefer = null) => `${mode}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`
  + (prefer && prefer.length && mode === 'TRANSIT' ? `:${prefer.join('>')}` : '');

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
function ask(key, from, to, mode, google, prefer) {
  if (!asking.has(key)) {
    const job = () => routeBetween(from, to, mode, { google, ...(mode === 'TRANSIT' && prefer ? { prefer } : {}) });
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

/*
 * The way chosen for a particular hop, over the map's Routes setting: the
 * train for the long hop across town when the setting says walk. Kept on this
 * device, per trip, beside the setting itself, and shared by the trip map and
 * the itinerary, which each hear when the other changes one.
 */
const CHOICES = 'wander-leg-choices-v1';
const CHOSEN = 'wander-leg-choices-change';
const NONE = Object.freeze({});

function readChoices() {
  try { return JSON.parse(localStorage.getItem(CHOICES)) || {}; } catch { return {}; }
}

/** [choices, choose]: this trip's chosen ways by hop ("fromId>toId"), and choose(hop, mode or null). */
export function useLegChoices(tripId) {
  const [all, setAll] = useState(NONE);
  useEffect(() => {
    const read = () => setAll(readChoices());
    const stored = (event) => { if (!event.key || event.key === CHOICES) read(); };
    read();
    window.addEventListener(CHOSEN, read);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener(CHOSEN, read);
      window.removeEventListener('storage', stored);
    };
  }, []);
  const choose = useCallback((hop, mode) => {
    if (!tripId) return;
    const next = readChoices();
    const trip = { ...(next[tripId] || {}) };
    if (mode) trip[hop] = mode; else delete trip[hop];
    if (Object.keys(trip).length) next[tripId] = trip; else delete next[tripId];
    try { localStorage.setItem(CHOICES, JSON.stringify(next)); } catch { /* this session still has it */ }
    setAll(next);
    window.dispatchEvent(new Event(CHOSEN));
  }, [tripId]);
  return [(tripId && all[tripId]) || NONE, choose];
}

/**
 * hops     [{ key, hop, from: { lat, lng }, to: { lat, lng }, km, prefer }] — `hop`
 *          names the pair of stops ("fromId>toId") a chosen way is kept under,
 *          `prefer` the train lines saved for it (lib/travel savedLines)
 * setting  the map's Routes setting: 'off', 'auto', or one way for every hop
 * choices  ways chosen for particular hops, from useLegChoices, over the setting
 *
 * Returns { on, byKey, gaps, timetable, modelled }: for each hop its options
 * (see travelOptions), the way the map draws and whether it was chosen for
 * that hop; the names of countries on the trip where some time is an
 * estimate because nothing could route that way, for saying why; and whether
 * any time came from a train timetable or the railway model rather than
 * Google, for saying so.
 */
export default function useLegs(hops, setting, choices = NONE) {
  const on = !!setting && setting !== 'off';
  const [countries, setCountries] = useState(null);
  const [answers, setAnswers] = useState({});
  // Borders are wanted for the Routes setting, or for a hop where the app answers a way itself.
  const own = hops.some((h) => nearOwn(h.from) && nearOwn(h.to));

  useEffect(() => {
    if ((!on && !own) || countries) return undefined;
    let live = true;
    loadBorders().then((c) => { if (live) setCountries(c || []); });
    return () => { live = false; };
  }, [on, own, countries]);

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

  const signature = hops.map((h) => legKey(h.from, h.to, 'TRANSIT', h.prefer)).join('|');
  useEffect(() => {
    if ((!on && !own) || !countries) return undefined;
    let live = true;
    const found = {};
    hops.forEach((h) => {
      const country = countryOf(h.from);
      // With Routes off, only what the app answers itself.
      const modes = on ? TRAVEL_MODES : ownModes(country);
      modes.forEach((mode) => {
        if (!canAsk(country, mode)) return;
        const key = legKey(h.from, h.to, mode, h.prefer);
        if (answers[key] !== undefined) return;
        const kept = recall(key);
        if (kept !== undefined) { found[key] = kept; return; }
        ask(key, h.from, h.to, mode, canRoute(country, mode), h.prefer)
          .then((answer) => { if (live) setAnswers((a) => ({ ...a, [key]: answer })); })
          // Not configured, or Google refused: this session goes without, and nothing is kept.
          .catch(() => { if (live) setAnswers((a) => ({ ...a, [key]: { mode, found: false } })); });
      });
    });
    if (Object.keys(found).length) setAnswers((a) => ({ ...a, ...found }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, own, countries, signature]);

  /*
   * A hop's last answer for each way, shown while a new one is asked for: a
   * route saved with Use asks again with its lines, and the hop should keep
   * its trains in the meantime rather than empty.
   */
  const last = useRef(new Map());

  return useMemo(() => {
    const byKey = {};
    const gaps = new Set();
    let timetable = false;
    let modelled = false;
    hops.forEach((h) => {
      const country = countryOf(h.from);
      const got = {};
      TRAVEL_MODES.forEach((mode) => {
        const answer = answers[legKey(h.from, h.to, mode, h.prefer)];
        const before = `${h.key}|${mode}`;
        if (answer !== undefined) { got[mode] = answer; last.current.set(before, answer); } else if (last.current.has(before)) got[mode] = last.current.get(before);
      });
      if (!on) {
        // Routes off: the trains the app found itself, and nothing else.
        const trains = countries && ownModes(country).length
          ? travelOptions(h.km, country, got).filter((o) => o.mode === 'TRANSIT' && o.trains) : [];
        byKey[h.key] = { km: h.km, options: trains, drawn: null, country };
        return;
      }
      const name = gapCountry(country);
      const options = countries ? travelOptions(h.km, country, got)
        : TRAVEL_MODES.map((mode) => ({ mode, minutes: null, waiting: true }));
      // A gap is an estimate nothing could route; the model's and the walk's say their own why.
      if (name && options.some((o) => o.estimate && !o.source)) gaps.add(name);
      if (options.some((o) => o.source === 'timetable')) timetable = true;
      if (options.some((o) => o.source === 'model')) modelled = true;
      const chosen = (h.hop && choices[h.hop]) || null;
      byKey[h.key] = {
        km: h.km,
        country,
        gap: name,
        options,
        chosen,
        drawn: chosen || drawnMode(setting, h.km, country),
      };
    });
    return { on, byKey, gaps: [...gaps], timetable, modelled };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, setting, countries, answers, signature, choices]);
}
