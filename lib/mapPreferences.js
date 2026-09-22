export const MAP_THEMES = ['auto', 'light', 'dark'];
export const MAP_TYPE_OPTIONS = [
  { value: 'roadmap', label: 'Road' },
  // Google's hybrid mode is satellite imagery with road and place labels.
  { value: 'hybrid', label: 'Satellite' },
  { value: 'terrain', label: 'Terrain' },
  { value: '3d', label: '3D', hint: 'Photorealistic' },
];
export const MAP_TYPES = MAP_TYPE_OPTIONS.map((option) => option.value);
// Routes between stops on the trip map: none (straight lines), each hop's suggested way, or one way for all.
export const MAP_ROUTE_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'auto', label: 'Auto', hint: 'Walk or transit' },
  { value: 'WALK', label: 'Walk' },
  { value: 'TRANSIT', label: 'Transit' },
  { value: 'DRIVE', label: 'Drive' },
];
export const MAP_ROUTES = MAP_ROUTE_OPTIONS.map((option) => option.value);
export const MAP_PREFERENCE_KEY = 'wander-map-preferences-v1';

export function normalizeMapPreferences(value) {
  return {
    theme: MAP_THEMES.includes(value?.theme) ? value.theme : 'auto',
    // Migrate the retired unlabelled option when reading existing preferences.
    type: value?.type === 'satellite' ? 'hybrid' : MAP_TYPES.includes(value?.type) ? value.type : 'roadmap',
    routes: MAP_ROUTES.includes(value?.routes) ? value.routes : 'off',
  };
}

export function mapColorScheme(theme, appScheme) {
  return theme === 'dark' ? 'DARK' : theme === 'light' ? 'LIGHT' : appScheme;
}
