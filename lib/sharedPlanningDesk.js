import { prepareDeskImage } from './deskImages.js';
import { readDesk } from './planningDesk.js';

const TABLE = 'trip_desk_items';
const BUCKET = 'planning-desk';
const fields = ['kind', 'text', 'side', 'day', 'x', 'y', 'width', 'height', 'rotation', 'colour', 'fontSize', 'name'];

export function deskChanges(before, after) {
  const previous = new Map(before.map(item => [item.id, item]));
  const changes = [];
  for (const item of after) {
    const old = previous.get(item.id);
    const patch = Object.fromEntries(fields.filter(key => item[key] !== undefined && (!old || item[key] !== old[key])).map(key => [key, item[key]]));
    if (!old || Object.keys(patch).length) changes.push({ id: item.id, patch, create: !old, blob: !old ? item.blob : null });
    previous.delete(item.id);
  }
  for (const id of previous.keys()) changes.push({ id, patch: {}, remove: true });
  return changes;
}

async function deskRows(client, tripId) {
  const { data, error } = await client.from(TABLE).select('*').eq('trip_id', tripId).eq('deleted', false).order('created_at').order('id');
  if (error) throw error;
  return data.map(row => ({ ...row.payload, id: row.id }));
}

/*
 * The last desk drawn for each person and trip ("<user>:<trip>"), so a desk
 * mounted again starts from what it showed rather than from nothing and the
 * notes dropping into the margins a second later. `ready` is whether it can
 * be edited as it stands; see openingDesk.
 */
const shown = new Map();
export const shownDesk = (key) => shown.get(key) || null;
export function keepDesk(key, items) { shown.set(key, { items, ready: true }); }

/*
 * The desk as a trip opens, read beside the trip itself (TripProvider), so
 * the notes are in the page's first paint. Rows only: the desk fetches the
 * pictures afterwards, and they fill in the way any photograph does. Notes
 * this device kept from before the desk was shared have to be taken across
 * before anything can be edited, so a desk with any (or a device that cannot
 * say) is drawn but not ready, and the desk takes its usual way in.
 */
export async function openingDesk(client, tripId, key) {
  const [items, local] = await Promise.all([
    deskRows(client, tripId),
    readDesk(key).then(list => list.length > 0, () => true),
  ]);
  // Not waited for, only started, so they are on their way before the desk is drawn.
  items.forEach(item => { if (item.picture) downloadPicture(client, item.picture).catch(() => {}); });
  // Pictures already fetched this visit stay with their notes.
  const before = new Map((shown.get(key)?.items || []).map(item => [item.id, item]));
  shown.set(key, { ready: !local, items: items.map(item => {
    const old = before.get(item.id);
    return old?.blob && old.picture === item.picture ? { ...item, blob: old.blob } : item;
  }) });
}

// Pictures by path, for the visit: a path is never given another picture, so
// the desk drawn again, or refreshed by a change, does not fetch them again.
const pictures = new Map();
function downloadPicture(client, path) {
  if (!pictures.has(path)) {
    pictures.set(path, client.storage.from(BUCKET).download(path).then(result => {
      if (result.error) throw result.error;
      return result.data;
    }).catch(error => { pictures.delete(path); throw error; }));
  }
  return pictures.get(path);
}

export function sharedDesk(client, tripId) {
  async function picturePath(item) {
    if (!item.blob) return {};
    const blob = await prepareDeskImage(item.blob);
    const path = `${tripId}/${item.id}`;
    const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
    if (error && String(error.statusCode) !== '409') throw error;
    pictures.set(path, Promise.resolve(blob));
    return { picture: path };
  }
  return {
    async load() {
      const items = await deskRows(client, tripId);
      return Promise.all(items.map(async item => {
        if (item.picture) item.blob = await downloadPicture(client, item.picture);
        return item;
      }));
    },
    async importLocal(items) {
      // Ignore existing IDs, including tombstones. A second device or a retry
      // must never replace shared edits with an old local copy.
      for (const change of deskChanges([], items)) {
        const picture = await picturePath(change);
        const { error } = await client.from(TABLE).upsert({ trip_id: tripId, id: change.id, payload: { ...change.patch, ...picture } },
          { onConflict: 'trip_id,id', ignoreDuplicates: true });
        if (error) throw error;
      }
    },
    async save(change) {
      const picture = await picturePath(change);
      const { error } = await client.rpc('save_desk_item', { p_trip: tripId, p_id: change.id,
        p_patch: { ...change.patch, ...picture }, p_create: !!change.create, p_delete: !!change.remove });
      if (error) throw error;
    },
    subscribe(refresh) {
      const channel = client.channel(`desk-${tripId}-${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `trip_id=eq.${tripId}` }, refresh)
        .subscribe(status => { if (status === 'SUBSCRIBED') refresh(); });
      return () => { client.removeChannel(channel); };
    },
  };
}
