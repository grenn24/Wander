export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Horizontal coordinates are relative to the free space in a margin. Changing
// screen size never moves an item over the itinerary or loses its placement.
export function deskPosition(item, laneWidth, anchors = {}) {
  const width = Math.min(item.width, laneWidth);
  return { width, left: clamp(item.x, 0, 1) * Math.max(0, laneWidth - width),
    top: Math.max(0, (anchors[item.day] || 0) + item.y) };
}

export function deskAnchor(top, anchors) {
  const day = Object.keys(anchors).filter(key => anchors[key] <= top)
    .sort((a, b) => anchors[b] - anchors[a])[0] || null;
  return { day, y: Math.max(0, top - (anchors[day] || 0)) };
}

let database;
function openDesk() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('wander-planning-desk', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('boards');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
  });
  return database;
}

export async function readDesk(key) {
  const db = await openDesk();
  return new Promise((resolve, reject) => {
    const request = db.transaction('boards').objectStore('boards').get(key);
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function writeDesk(key, items) {
  const db = await openDesk();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('boards', 'readwrite');
    tx.objectStore('boards').put(items, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
