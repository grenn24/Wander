import { listDownloads, removeDownload } from '/offline-store.js';
import { tripNow, validZone } from '/trip-time.js';

const root = document.getElementById('reader');
const fromPath = location.pathname.match(/^\/trips\/([^/]+)/)?.[1];
let selected = new URLSearchParams(location.search).get('trip') || fromPath || '';
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function button(text, action) { const b = el('button', text); b.onclick = action; return b; }
function link(text, href, className = 'button') { const a = el('a', text, className); a.href = href; return a; }
function card(a) {
  const box = el('article', null, 'card');
  box.append(el('p', [a.start_time?.slice(0, 5), a.end_time?.slice(0, 5)].filter(Boolean).join(' – '), 'time'), el('h3', a.title));
  if (a.location) box.append(el('p', a.location));
  if (a.booking_ref) box.append(el('p', `Booking: ${a.booking_ref}`));
  for (const [key, value] of Object.entries(a.details || {})) {
    if (value) box.append(el('p', `${key.replaceAll('_', ' ')}: ${value}`, 'muted'));
  }
  if (a.notes) box.append(el('p', a.notes, 'notes'));
  if (a.location || (a.lat != null && a.lng != null)) {
    const destination = a.lat != null && a.lng != null ? `${a.lat},${a.lng}` : a.location;
    box.append(link('Directions · connection needed', `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`));
  }
  return box;
}
async function render() {
  try {
    const saved = await listDownloads();
    const snapshot = saved.find((s) => s.id === selected);
    root.replaceChildren();
    root.append(el('p', 'Saved on this device · read only', 'tag'));
    if (!snapshot) {
      root.append(el('h1', 'Your downloaded trips'));
      if (!saved.length) root.append(el('p', 'No trips downloaded here. Connect to the internet, open a trip and choose Download for offline.'));
      else if (selected) root.append(el('p', 'This trip has not been downloaded. Your other saved trips are below.'));
      for (const s of saved) {
        const box = el('section', null, 'card');
        box.append(el('h2', s.trip.name), el('p', s.trip.destination), el('p', `Saved ${new Date(s.savedAt).toLocaleString()}`, 'muted'));
        box.append(button('Open saved trip', () => { selected = s.id; history.replaceState(null, '', `/offline.html?trip=${encodeURIComponent(s.id)}`); render(); }));
        root.append(box);
      }
      return;
    }
    const { trip, activities, packing } = snapshot;
    root.append(link('← All downloads', '/offline.html'), el('h1', trip.name), el('p', `${trip.destination || ''} · ${trip.start_date} – ${trip.end_date}`));
    root.append(el('p', `Saved ${new Date(snapshot.savedAt).toLocaleString()}. Changes made afterwards are not included.`, 'muted'));
    root.append(el('p', validZone(trip.timezone) ? `Local times in ${trip.timezone}. Flights show their endpoint time zones.` : 'Destination time zone has not been set. Check local times before travelling.', 'muted'));
    const state = tripNow(trip, activities);
    const lead = state.now || state.next;
    if (state.live && lead) {
      const box = card(lead); box.classList.add('today');
      box.prepend(el('p', `Today · ${state.now ? 'Now' : 'Up next'}`, 'tag')); root.append(box);
    }
    const ordered = activities.slice().sort((a, b) => a.day.localeCompare(b.day) || (a.start_time || '99').localeCompare(b.start_time || '99') || (a.sort_order || 0) - (b.sort_order || 0));
    let day;
    for (const a of ordered) { if (a.day !== day) { day = a.day; root.append(el('h2', day)); } root.append(card(a)); }
    if (trip.notes) root.append(el('h2', 'Trip notes'), el('p', trip.notes, 'card notes'));
    if (packing.length) {
      root.append(el('h2', 'Packing list')); const list = el('ul', null, 'packing');
      packing.forEach((p) => list.append(el('li', `${p.packed ? '✓' : '○'} ${p.label}${p.qty > 1 ? ` × ${p.qty}` : ''}`))); root.append(list);
    }
    const actions = el('div', null, 'actions');
    actions.append(link('Open live trip', `/trips/${trip.id}`), button('Remove download', async () => {
      await removeDownload(trip.id); selected = ''; await render();
    })); root.append(actions);
    root.append(el('p', 'Anyone using this browser can read downloaded trips. Signing out of Wander removes them. Browser storage can be cleared by your device; keep a PDF for essential bookings.', 'muted'));
  } catch (e) { root.replaceChildren(el('h1', 'Could not open downloads'), el('p', e.message)); }
}
render();
// Keep Today current without interrupting scrolling or keyboard focus.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('storage', (event) => { if (event.key === 'wander.offline.owner') render(); });
