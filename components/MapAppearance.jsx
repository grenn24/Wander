'use client';
import { useEffect, useState } from 'react';
import { Layers, X } from 'lucide-react';
import Select from '@/components/Select';
import { MAP_PREFERENCE_KEY, MAP_TYPE_OPTIONS, normalizeMapPreferences } from '@/lib/mapPreferences';

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
  const imagery = preferences.type === 'hybrid';
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
          <Select label="Map theme" value={preferences.theme} options={THEMES}
            onChange={(theme) => onChange({ theme })} />
        </div>
        <div className="map-appearance-field">
          <span>Map type</span>
          <Select label="Map type" value={preferences.type} options={MAP_TYPE_OPTIONS}
            onChange={(type) => onChange({ type })} />
        </div>
        <p>{imagery ? 'Satellite imagery keeps its natural colours. Your theme applies to road and terrain maps.'
          : 'Saved on this device, separately from the app theme.'}</p>
      </div>
    </details>
  );
}
