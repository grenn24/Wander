const DB = 'wander-offline';
const OWNER = 'wander.offline.owner';

async function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('trips', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('This browser could not open offline storage.'));
  });
}

async function run(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('trips', mode);
    let req;
    try { req = action(tx.objectStore('trips')); }
    catch (e) { tx.abort(); db.close(); reject(e); return; }
    tx.oncomplete = () => { db.close(); resolve(req.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Offline storage is unavailable or full. Try removing an older download.')); };
  });
}

export async function clearDownloads() {
  localStorage.removeItem(OWNER);
  await run('readwrite', (store) => store.clear());
}

export async function setDownloadOwner(userId) {
  const previous = localStorage.getItem(OWNER);
  if (userId) localStorage.setItem(OWNER, userId);
  if (previous && previous !== userId) await run('readwrite', (store) => store.clear());
}

const pick = (row, keys) => Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));

export function tripSnapshot(userId, trip, activities, packing) {
  return {
    id: trip.id, userId, savedAt: new Date().toISOString(),
    trip: pick(trip, ['id', 'name', 'destination', 'start_date', 'end_date', 'timezone', 'currency', 'notes']),
    activities: activities.map((a) => pick(a, ['id', 'day', 'start_time', 'end_time', 'title', 'category',
      'subtype', 'details', 'location', 'lat', 'lng', 'cost', 'booking_ref', 'notes', 'sort_order'])),
    packing: packing.map((p) => pick(p, ['id', 'label', 'qty', 'packed'])),
  };
}

export async function saveDownload(snapshot) {
  // Do not recreate a signed-out account's downloads if a network request
  // finishes after the person has left or switched accounts.
  if (localStorage.getItem(OWNER) !== snapshot.userId) throw new Error('Your account changed. Sign in and download the trip again.');
  await run('readwrite', (store) => {
    if (localStorage.getItem(OWNER) !== snapshot.userId) throw new Error('Your account changed. Download the trip again.');
    return store.put(snapshot);
  });
}

export async function listDownloads() {
  const owner = localStorage.getItem(OWNER);
  if (!owner) return [];
  return (await run('readonly', (store) => store.getAll())).filter((s) => s.userId === owner);
}

export async function removeDownload(id) {
  await run('readwrite', (store) => store.delete(id));
}
