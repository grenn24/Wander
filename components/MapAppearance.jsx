'use client';
import { useEffect, useRef, useState } from 'react';
import { Layers, X } from 'lucide-react';
import Select from '@/components/Select';
import {
  MAP_PREFERENCE_KEY, MAP_TYPE_OPTIONS, MAP_ROUTE_OPTIONS, normalizeMapPreferences,
} from '@/lib/mapPreferences';

const CHANGE = 'wander-map-preferences-change';
const THEMES = [
  { value: 'auto', label: 'Follow app' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function readPreferences() {
  try { return normalizeMapPreferences(JSON.parse(localStorage.getItem(MAP_PREFERENCE_KEY))); }
  catch { return normalizeMapPreferences(null); }
}

/*
 * Read at once rather than a tick later. Waiting meant the map and the button
 * that sets its look arrived after the page around them had settled, which is
 * seen as a control appearing from nowhere. Every map in the app is drawn
 * after its trip has loaded, so there is no server-rendered map to disagree
 * with; where there is no store to read, the defaults stand.
 */
export function useMapPreferences() {
  const held = typeof window === 'undefined' ? null : readPreferences();
  const [preferences, setPreferences] = useState(() => held || normalizeMapPreferences(null));
  const [ready, setReady] = useState(!!held);
  useEffect(() => {
    const read = () => setPreferences(readPreferences());
    const changed = (event) => setPreferences(normalizeMapPreferences(event.detail));
    const stored = (event) => { if (!event.key || event.key === MAP_PREFERENCE_KEY) read(); };
    read();
    setReady(true);
    window.addEventListener(CHANGE, changed);
    window.addEventListener('storage', stored);
    return () => {
      window.removeEventListener(CHANGE, changed);
      window.removeEventListener('storage', stored);
    };
  }, []);
  function update(patch) {
    const next = normalizeMapPreferences({ ...preferences, ...patch });
    setPreferences(next);
    try { localStorage.setItem(MAP_PREFERENCE_KEY, JSON.stringify(next)); } catch { /* Session still works. */ }
    window.dispatchEvent(new CustomEvent(CHANGE, { detail: next }));
  }
  return [preferences, update, ready];
}

/*
 * Put the panel away, folding its options up first (app/motion.css). A
 * <details> closes the instant it is told to, so it is told once the fold has
 * played; for anyone who has asked for less motion, straight away.
 */
const FOLD_MS = 140;
function shut(panel, refocus = false) {
  if (!panel || !panel.open || panel.dataset.state === 'exit') return;
  const finish = () => {
    delete panel.dataset.state;
    panel.open = false;
    if (refocus) panel.querySelector('summary')?.focus();
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
  panel.dataset.state = 'exit';
  setTimeout(finish, FOLD_MS);
}

export default function MapAppearance({ preferences, onChange, allow3D = false, allowRoutes = false }) {
  const is3D = preferences.type === '3d';
  const imagery = preferences.type === 'hybrid' || is3D;
  const panel = useRef(null);
  const [open, setOpen] = useState(false);

  /*
   * A press anywhere else — on the map, the stop list, the day chips — puts
   * the panel away, the way every other popover in the app goes. Its choice
   * lists are drawn outside it, on the page, so a press in one of those is
   * still a press in the panel. Heard before the map hears it, and not
   * stopped: the same press still does whatever it does on the map.
   */
  useEffect(() => {
    if (!open) return undefined;
    const pressed = (event) => {
      const el = panel.current;
      if (!el || !el.open) return;
      const path = event.composedPath ? event.composedPath() : [event.target];
      if (path.includes(el)) return;
      if (path.some((node) => node instanceof Element && node.classList.contains('pop'))) return;
      shut(el);
    };
    document.addEventListener('pointerdown', pressed, true);
    return () => document.removeEventListener('pointerdown', pressed, true);
  }, [open]);

  return (
    <details ref={panel} className="map-appearance" onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        shut(event.currentTarget, true);
      }
    }}>
      <summary aria-label="Map appearance" onClick={(event) => {
        // Opening is the browser's; closing folds away first.
        const panel = event.currentTarget.parentElement;
        if (panel.open) { event.preventDefault(); shut(panel); }
      }}>
        <Layers size={15} aria-hidden="true" /><span className="map-appearance-label">Map appearance</span>
      </summary>
      <button type="button" className="btn icon-btn map-appearance-close" aria-label="Close map appearance"
        onClick={(event) => shut(event.currentTarget.closest('details'), true)}><X size={16} aria-hidden="true" /></button>
      <div className="map-appearance-options">
        <div className="map-appearance-field">
          <span>Map theme</span>
          <Select label="Map theme" value={preferences.theme} options={THEMES} disabled={imagery}
            onChange={(theme) => onChange({ theme })} />
        </div>
        <div className="map-appearance-field">
          <span>Map type</span>
          <Select label="Map type" value={preferences.type} options={MAP_TYPE_OPTIONS.filter((option) => allow3D || option.value !== '3d')}
            onChange={(type) => onChange({ type })} />
        </div>
        {/* Only on a map of a trip's stops: routes are the way from one stop to the next. */}
        {allowRoutes ? (
          <div className="map-appearance-field">
            <span>Routes between stops</span>
            <Select label="Routes between stops" value={preferences.routes} options={MAP_ROUTE_OPTIONS}
              onChange={(routes) => onChange({ routes })} />
          </div>
        ) : null}
        {allowRoutes && preferences.routes !== 'off' ? (
          <p>Routes and times from Google. A time marked ~ is an estimate, where Google cannot route that way.</p>
        ) : null}
        <p>{is3D ? 'Explore real buildings and landscapes. Detail varies by location; imagery keeps its natural colours.'
          : imagery ? 'Satellite imagery keeps its natural colours. Your theme applies to road and terrain maps.'
          : 'Saved on this device, separately from the app theme.'}</p>
      </div>
    </details>
  );
}
