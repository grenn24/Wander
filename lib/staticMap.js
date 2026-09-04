import { MAP_TYPES } from './mapPreferences.js';

export function staticMapOptions(params) {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!params.get('lat')?.trim() || !params.get('lng')?.trim()
    || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const color = params.get('color') || '';
  return { lat, lng, type: MAP_TYPES.includes(params.get('type')) ? params.get('type') : 'roadmap',
    dark: params.get('theme') === 'dark', pinned: params.get('pin') === '1',
    compact: params.get('compact') === '1', color: /^[a-f\d]{6}$/i.test(color) ? color : 'cf846e' };
}

export function staticMapURL(options, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
  const point = `${options.lat},${options.lng}`;
  url.search = new URLSearchParams({ center: point, zoom: options.pinned ? '15' : '13',
    size: options.compact ? '640x320' : '640x640', scale: '2', format: 'png', maptype: options.type, key }).toString();
  if (options.pinned) url.searchParams.set('markers', `color:0x${options.color}|label:1|${point}`);
  if (options.dark && !['satellite', 'hybrid'].includes(options.type)) {
    for (const style of [
      'element:geometry|color:0x242b32', 'element:labels.text.stroke|color:0x242b32',
      'element:labels.text.fill|color:0xbfc6c7', 'feature:road|element:geometry|color:0x46505b',
      'feature:water|element:geometry|color:0x102d40',
      'feature:poi.park|element:geometry|color:0x293d35',
    ]) url.searchParams.append('style', style);
  }
  return url;
}
