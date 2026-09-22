// Both Google renderers use this same card. Only the map's anchoring shell
// differs; photos, typography, close control and actions must stay identical.
export function createMapPopup(card, { onClose, onPhoto } = {}) {
  const title = document.createElement('strong');
  const el = document.createElement('div');
  el.className = 'gminfo';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'gminfo-x';
  close.dataset.tip = 'Close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '✕';
  close.addEventListener('click', () => onClose?.());
  el.append(close);

  if (card.photoRef) {
    const shot = document.createElement('button');
    shot.type = 'button';
    shot.className = 'gminfo-shot';
    shot.dataset.tip = 'Photos';
    shot.setAttribute('aria-label', `Photos of ${card.title}`);
    const img = document.createElement('img');
    img.alt = '';
    // A photo that cannot be had leaves the card, as it does in the lists, not a broken image.
    img.addEventListener('error', () => {
      shot.remove();
      title.style.paddingRight = '26px';
    });
    img.src = `/api/places/photo?ref=${encodeURIComponent(card.photoRef)}&w=420`;
    shot.append(img);
    shot.addEventListener('click', () => onPhoto?.({
      photoRef: card.photoRef, photos: card.photos, placeId: card.placeId, title: card.title,
    }));
    el.append(shot);
  }

  const body = document.createElement('div');
  body.className = 'gminfo-body';
  title.className = 'gminfo-title';
  title.textContent = card.title || '';
  // Keep the close control clear of titles when there is no photo above them.
  if (!card.photoRef) title.style.paddingRight = '26px';
  body.append(title);
  if (card.meta) {
    const meta = document.createElement('div');
    meta.className = 'gminfo-meta';
    meta.textContent = card.meta;
    body.append(meta);
  }
  if (card.action && card.onAction) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'gminfo-go';
    action.textContent = card.action;
    action.addEventListener('click', card.onAction);
    body.append(action);
  }
  el.append(body);
  return el;
}

export function placePopupMeta(place) {
  const bits = [];
  if (place.detail) bits.push(place.detail);
  if (place.rating) bits.push(`★ ${Number(place.rating).toFixed(1)}`);
  if (place.km != null) bits.push(`${place.km < 1 ? `${Math.round(place.km * 1000)} m` : `${place.km.toFixed(1)} km`} from map centre`);
  return bits.join(' · ');
}
