export const MAP_THEMES = ['auto', 'light', 'dark'];
export const MAP_TYPES = ['roadmap', 'satellite', 'hybrid', 'terrain'];
export const MAP_PREFERENCE_KEY = 'wander-map-preferences-v1';

export function normalizeMapPreferences(value) {
  return {
    theme: MAP_THEMES.includes(value?.theme) ? value.theme : 'auto',
    type: MAP_TYPES.includes(value?.type) ? value.type : 'roadmap',
  };
}

export function mapColorScheme(theme, appScheme) {
  return theme === 'dark' ? 'DARK' : theme === 'light' ? 'LIGHT' : appScheme;
}
