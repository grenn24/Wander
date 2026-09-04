'use client';
import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { MAP_PREFERENCE_KEY, normalizeMapPreferences } from '@/lib/mapPreferences';

const CHANGE = 'wander-map-preferences-change';

function readPreferences() {
  try { return normalizeMapPreferences(JSON.parse(localStorage.getItem(MAP_PREFERENCE_KEY))); }
  catch { return normalizeMapPreferences(null); }
}

export function useMapPreferences() {
  const [preferences, setPreferences] = useState(() => normalizeMapPreferences(null));
  useEffect(() => {
    const read = () => setPreferences(readPreferences());
    const changed = (event) => setPreferences(normalizeMapPreferences(event.detail));
    const stored = (event) => { if (!event.key || event.key === MAP_PREFERENCE_KEY) read(); };
    read();
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
  return [preferences, update];
}

export default function MapAppearance({ preferences, onChange }) {
  const imagery = ['satellite', 'hybrid'].includes(preferences.type);
  return (
    <details className="map-appearance" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary').focus();
      }
    }}>
      <summary><Layers size={15} aria-hidden="true" /> Map appearance</summary>
      <div className="map-appearance-options">
        <label>Map theme
          <select value={preferences.theme} onChange={(e) => onChange({ theme: e.target.value })}>
            <option value="auto">Follow app</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>Map type
          <select value={preferences.type} onChange={(e) => onChange({ type: e.target.value })}>
            <option value="roadmap">Road</option>
            <option value="satellite">Satellite</option>
            <option value="hybrid">Satellite with labels</option>
            <option value="terrain">Terrain</option>
          </select>
        </label>
        <p>{imagery ? 'Satellite imagery keeps its natural colours. Your theme applies to road and terrain maps.'
          : 'Saved on this device, separately from the app theme.'}</p>
      </div>
    </details>
  );
}
