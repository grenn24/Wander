'use client';
import { useEffect, useState } from 'react';
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

export function useMapPreferences() {
  const [preferences, setPreferences] = useState(() => normalizeMapPreferences(null));
  const [ready, setReady] = useState(false);
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

export default function MapAppearance({ preferences, onChange, allow3D = false, allowRoutes = false }) {
  const is3D = preferences.type === '3d';
  const imagery = preferences.type === 'hybrid' || is3D;
  return (
    <details className="map-appearance" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary').focus();
      }
    }}>
      <summary aria-label="Map appearance">
        <Layers size={15} aria-hidden="true" /><span className="map-appearance-label">Map appearance</span>
      </summary>
      <button type="button" className="btn icon-btn map-appearance-close" aria-label="Close map appearance"
        onClick={(event) => {
          const panel = event.currentTarget.closest('details');
          panel.open = false;
          panel.querySelector('summary').focus();
        }}><X size={16} aria-hidden="true" /></button>
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
