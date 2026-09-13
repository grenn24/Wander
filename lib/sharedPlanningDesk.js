import { prepareDeskImage } from './deskImages.js';

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

export function sharedDesk(client, tripId) {
  const pictures = new Map();
  async function picturePath(item) {
    if (!item.blob) return {};
    const blob = await prepareDeskImage(item.blob);
    const path = `${tripId}/${item.id}`;
    const { error } = await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type });
    if (error && String(error.statusCode) !== '409') throw error;
    pictures.set(path, blob);
    return { picture: path };
  }
  return {
    async load() {
      const { data, error } = await client.from(TABLE).select('*').eq('trip_id', tripId).eq('deleted', false).order('created_at').order('id');
      if (error) throw error;
      return Promise.all(data.map(async row => {
        const item = { ...row.payload, id: row.id };
        if (item.picture) {
          if (!pictures.has(item.picture)) {
            const result = await client.storage.from(BUCKET).download(item.picture);
            if (result.error) throw result.error;
            pictures.set(item.picture, result.data);
          }
          item.blob = pictures.get(item.picture);
        }
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
