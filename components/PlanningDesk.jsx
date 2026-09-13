'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeftRight, Grip, ImagePlus, Maximize2, Plus, RotateCcw, StickyNote, Trash2, Undo2, X } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import Select from '@/components/Select';
import { clamp, deskAnchor, deskPosition, readDesk, writeDesk } from '@/lib/planningDesk';
import { deskChanges, sharedDesk } from '@/lib/sharedPlanningDesk';
import styles from './PlanningDesk.module.css';

function DeskPhoto({ blob, name }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return undefined;
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <img src={url} alt={name || 'Planning picture'} draggable={false} /> : null;
}

export default function PlanningDesk(props) {
  const { user } = useApp();
  return <Desk key={`${user?.id}:${props.tripId}`} {...props} storageKey={`${user?.id}:${props.tripId}`} />;
}

function Desk({ containerRef, storageKey, tripId, days, activeDay }) {
  const { supabase } = useApp();
  const remote = useMemo(() => sharedDesk(supabase, tripId), [supabase, tripId]);
  const [items, setItems] = useState([]);
  const current = useRef([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [deleted, setDeleted] = useState(null);
  const [bounds, setBounds] = useState({ wide: false, left: 0, width: 0, lane: 0, height: 600, anchors: {} });
  const fileInput = useRef(null);
  const uploadTarget = useRef(null);
  const dialogRef = useRef(null);
  const drag = useRef(null);
  const pending = useRef([]);
  const saving = useRef(false);
  const baseline = useRef(current.current);
  const revision = useRef(0);
  const refreshRef = useRef(() => {});
  const reloadRef = useRef(() => {});
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let cancelled = false, loaded = false, loading = false, request = 0;
    async function refresh() {
      if (!loaded || pending.current.length || current.current !== baseline.current) return;
      const version = revision.current, mine = ++request;
      try {
        const data = await remote.load();
        if (cancelled || mine !== request || version !== revision.current || pending.current.length) return;
        current.current = data; baseline.current = data; setItems(data);
      } catch { if (!cancelled) setError('Could not sync the shared desk. Check your connection and retry.'); }
    }
    async function load() {
      if (loading || cancelled) return;
      loading = true;
      try {
        // Check trip access before touching the local prototype data.
        await remote.load();
        const local = await readDesk(storageKey);
        if (cancelled) return;
        if (local.length) {
          await remote.importLocal(local);
          await writeDesk(storageKey, []);
        }
        const data = await remote.load();
        if (cancelled) return;
        current.current = data; baseline.current = data; setItems(data); setReady(true);
        setMessage('Shared with everyone in this trip'); setError(''); loaded = true;
      } catch { if (!cancelled) setError('Could not open the shared desk. Your local notes are kept until they are shared. Retry when connected.'); }
      finally { loading = false; }
    }
    refreshRef.current = refresh;
    reloadRef.current = load;
    const unsubscribe = remote.subscribe(refresh);
    const onFocus = () => { if (loaded) { persist(current.current); } else load(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    const beforeUnload = event => {
      if (pending.current.length || current.current !== baseline.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    load();
    return () => {
      cancelled = true; alive.current = false; unsubscribe();
      window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [storageKey, remote]);

  async function persist(next) {
    pending.current.push(...deskChanges(baseline.current, next));
    baseline.current = next;
    if (saving.current) return;
    saving.current = true;
    setMessage('Saving…');
    try {
      while (pending.current.length) {
        await remote.save(pending.current[0]);
        pending.current.shift();
      }
      if (alive.current) { setMessage('Shared with everyone in this trip'); setError(''); refreshRef.current(); }
    } catch {
      if (alive.current) { setMessage('Changes not saved'); setError('Could not save shared changes. Keep this page open, check your connection and retry.'); }
    } finally { saving.current = false; }
  }
  function retry() { if (ready) persist(current.current); else reloadRef.current(); }
  function change(next, save = true) {
    revision.current += 1;
    current.current = next; setItems(next);
    if (save) persist(next);
  }
  function patch(id, values, save = true) {
    change(current.current.map(item => item.id === id ? { ...item, ...values } : item), save);
  }

  useEffect(() => {
    const itinerary = containerRef.current;
    const main = itinerary?.closest('.main');
    if (!itinerary || !main) return;
    let frame;
    function measure() {
      const r = itinerary.getBoundingClientRect(), m = main.getBoundingClientRect();
      const lane = Math.floor(Math.min(r.left - m.left, m.right - r.right) - 44);
      const anchors = {};
      days.forEach(day => {
        const element = document.getElementById(`day-${day}`);
        if (element) anchors[day] = element.getBoundingClientRect().top - r.top;
      });
      const next = { wide: lane >= 180, left: m.left - r.left + 20, width: m.width - 40,
        lane: Math.max(180, lane), height: r.height, anchors };
      setBounds(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    }
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); });
    observer.observe(itinerary); observer.observe(main); measure();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [containerRef, days]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const oldOverflow = document.body.style.overflow;
    const opener = document.activeElement;
    document.body.style.overflow = 'hidden';
    dialogRef.current.querySelector('button')?.focus();
    return () => { document.body.style.overflow = oldOverflow; opener?.focus?.(); };
  }, [open]);

  function add(kind = 'note', extra = {}, target) {
    if (!ready) return;
    const side = target?.side || (current.current.length % 2 ? 'right' : 'left');
    const day = target?.day ?? activeDay ?? days[0] ?? null;
    const siblings = current.current.filter(item => item.side === side && item.day === day).length;
    const item = { id: crypto.randomUUID(), kind, text: '', side, day,
      x: target?.x ?? .3, y: target?.y ?? 60 + siblings * 45,
      width: 224, height: kind === 'note' ? 190 : 240, rotation: side === 'left' ? -2 : 2,
      colour: ['sand', 'sage', 'rose'][current.current.length % 3], ...extra };
    change([...current.current, item]); setSelected(item.id);
    if (!bounds.wide) setOpen(true);
  }

  function targetAt(event, side) {
    const rect = event.currentTarget.getBoundingClientRect();
    const top = Math.max(0, event.clientY - rect.top - 28);
    return { side, ...deskAnchor(top, bounds.anchors),
      x: clamp((event.clientX - rect.left - 60) / Math.max(1, bounds.lane - 224), 0, 1) };
  }

  async function images(files, target) {
    for (const file of Array.from(files).slice(0, 8)) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
        setError('Choose a JPG, PNG, WebP or GIF picture.'); continue;
      }
      if (file.size > 8 * 1024 * 1024) { setError('Choose pictures smaller than 8 MB each.'); continue; }
      if (current.current.reduce((sum, item) => sum + (item.blob?.size || 0), 0) + file.size > 40 * 1024 * 1024) {
        setError('This desk has reached its 40 MB picture limit. Remove a picture to make room.'); break;
      }
      add('photo', { blob: file, name: file.name }, target);
      if (target) target = { ...target, y: target.y + 40 };
    }
  }

  function startDrag(event, item, mode) {
    if (event.button !== 0 || (open && mode === 'move')) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(item.id);
    const position = deskPosition(item, bounds.lane, bounds.anchors);
    const element = event.currentTarget.closest('article');
    const rect = element.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    drag.current = { id: item.id, mode, startX: event.clientX, startY: event.clientY,
      startScroll: window.scrollY, item, position, center,
      width: element.offsetWidth, height: element.offsetHeight,
      maxWidth: open ? element.parentElement.clientWidth : bounds.lane,
      angle: Math.atan2(event.clientY - center.y, event.clientX - center.x) };
  }
  function moving(event) {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.startX, dy = event.clientY - d.startY + window.scrollY - d.startScroll;
    if (d.mode === 'rotate') {
      const angle = Math.atan2(event.clientY + window.scrollY - d.startScroll - d.center.y, event.clientX - d.center.x);
      const delta = Math.atan2(Math.sin(angle - d.angle), Math.cos(angle - d.angle)) * 180 / Math.PI;
      const rotation = clamp(d.item.rotation + delta, -45, 45);
      patch(d.id, { rotation: Math.abs(rotation) < 2 ? 0 : Math.round(rotation) }, false);
      return;
    }
    if (d.mode === 'resize') {
      const angle = d.item.rotation * Math.PI / 180;
      patch(d.id, { width: clamp(d.width + dx * Math.cos(angle) + dy * Math.sin(angle), 160, Math.min(360, d.maxWidth)),
        height: clamp(d.height - dx * Math.sin(angle) + dy * Math.cos(angle), 130, 480) }, false); return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    const laneLeft = rect.left + bounds.left + (side === 'right' ? bounds.width - bounds.lane : 0);
    const startOffset = d.startX - (rect.left + bounds.left + (d.item.side === 'right' ? bounds.width - bounds.lane : 0) + d.position.left);
    const left = event.clientX - laneLeft - startOffset;
    const top = clamp(d.position.top + dy, 0, Math.max(0, bounds.height - d.item.height));
    patch(d.id, { side, x: clamp(left / Math.max(1, bounds.lane - d.position.width), 0, 1),
      ...deskAnchor(top, bounds.anchors) }, false);
  }
  function finishDrag() { if (drag.current) { drag.current = null; persist(current.current); } }
  function remove(item) {
    setDeleted(item); change(current.current.filter(entry => entry.id !== item.id)); setSelected(null);
  }

  function card(item, board = false) {
    const position = deskPosition(item, bounds.lane, bounds.anchors);
    const style = board ? { width: item.width, maxWidth: '100%', height: item.height, transform: `rotate(${item.rotation}deg)` } : { width: position.width, height: item.height,
      left: (item.side === 'right' ? bounds.width - bounds.lane : 0) + position.left,
      top: position.top, transform: `rotate(${item.rotation}deg)` };
    const active = selected === item.id;
    return <article key={item.id} className={`${styles.item} ${styles[item.colour]} ${item.kind === 'photo' ? styles.photo : ''} ${active ? styles.selected : ''}`}
      style={style} aria-label={item.kind === 'note' ? 'Planning note' : 'Planning picture'}
      onFocusCapture={() => setSelected(item.id)} onPointerDown={() => setSelected(item.id)}>
      <div className={styles.handle} onPointerDown={event => startDrag(event, item, 'move')}
        onPointerMove={moving} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
        <button type="button" className={styles.grip} aria-label="Move item (arrow keys to move)"
          onKeyDown={event => {
            if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
            event.preventDefault(); patch(item.id, { x: clamp(item.x + (event.key === 'ArrowLeft' ? -.05 : event.key === 'ArrowRight' ? .05 : 0), 0, 1),
              y: Math.max(0, item.y + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0)) });
          }}><Grip size={15} /></button>
        <span>{item.day && days.includes(item.day) ? `Day ${days.indexOf(item.day) + 1}` : 'Trip idea'}</span>
        <button type="button" aria-label="Delete item" onPointerDown={event => event.stopPropagation()} onClick={() => remove(item)}><Trash2 size={13} /></button>
      </div>
      {item.kind === 'photo' ? <div className={styles.picture}><DeskPhoto blob={item.blob} name={item.name} /></div> : null}
      <textarea aria-label={item.kind === 'photo' ? 'Picture caption' : 'Note text'} placeholder={item.kind === 'photo' ? 'Add a caption…' : 'A thought, a reminder, a place to try…'}
        value={item.text} onChange={event => patch(item.id, { text: event.target.value })} />
      {active ? <div className={styles.editTools} onPointerDown={event => event.stopPropagation()}>
        <div className={styles.toolRow}>
          <Select label="Attach item to day" className={styles.daySelect} value={days.includes(item.day) ? item.day : ''}
            onChange={value => patch(item.id, { day: value || null, y: 50 })}
            options={[{ value: '', label: 'Whole trip' }, ...days.map((day, i) => ({ value: day, label: `Day ${i + 1}` }))]} />
          <button type="button" aria-label="Move to other side" onClick={() => patch(item.id, { side: item.side === 'left' ? 'right' : 'left' })}><ArrowLeftRight size={15} /></button>
          <button type="button" aria-label="Straighten item" onClick={() => patch(item.id, { rotation: 0 })}><RotateCcw size={15} /></button>
          {['sand','sage','rose'].map(colour => <button key={colour} type="button" className={`${styles.swatch} ${styles[colour]}`} aria-label={`${colour} paper`} aria-pressed={item.colour === colour} onClick={() => patch(item.id, { colour })} />)}
        </div>
      </div> : null}
      {active ? <button type="button" className={styles.rotate} aria-label="Rotate item" data-tip="Drag to rotate · Double-click to straighten"
        onDoubleClick={() => patch(item.id, { rotation: 0 })} onPointerDown={event => startDrag(event, item, 'rotate')}
        onPointerMove={moving} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={event => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault(); patch(item.id, { rotation: clamp(item.rotation + (event.key === 'ArrowLeft' ? -1 : 1), -45, 45) });
          }
        }}><RotateCcw size={14} /></button> : null}
      <button type="button" className={styles.resize} aria-label="Resize item" data-tip="Drag to resize" onPointerDown={event => startDrag(event, item, 'resize')}
        onPointerMove={moving} onPointerUp={finishDrag} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); patch(item.id, {
            width: clamp(item.width + (event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0), 160, Math.min(360, bounds.lane)),
            height: clamp(item.height + (event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0), 130, 480),
          });
        }}><Maximize2 size={12} /></button>
    </article>;
  }

  const toolbar = <div className={styles.toolbar}>
    <button type="button" disabled={!ready} onClick={() => add()}><StickyNote size={15} /> Note</button>
    <button type="button" disabled={!ready} onClick={() => { uploadTarget.current = null; fileInput.current.click(); }}><ImagePlus size={15} /> Picture</button>
    {deleted ? <button type="button" onClick={() => { change([...current.current, deleted]); setDeleted(null); }}><Undo2 size={15} /> Undo delete</button> : null}
    <span role="status">{message || 'Loading shared desk…'}</span>
  </div>;

  return <>
    <button type="button" className="btn sm" onClick={() => setOpen(true)}><StickyNote size={15} /> Planning desk{items.length ? ` · ${items.length}` : ''}</button>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={event => { images(event.target.files, uploadTarget.current); event.target.value = ''; }} />
    {bounds.wide ? <div className={styles.canvas} style={{ left: bounds.left, width: bounds.width, height: bounds.height }}>
      {['left','right'].map(side => <div key={side} className={styles.lane} style={{ width: bounds.lane, [side]: 0 }}
        aria-label={`${side} planning margin`} onClick={() => setSelected(null)}
        onDoubleClick={event => add('note', {}, targetAt(event, side))}
        onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={event => { event.preventDefault(); images(event.dataTransfer.files, targetAt(event, side)); }} />)}
      <div className={styles.marginTools} role="toolbar" aria-label="Add to planning desk" style={{ maxWidth: bounds.lane }}>
        <button type="button" disabled={!ready} onClick={() => add()}><StickyNote size={18} /> Add note</button>
        <button type="button" disabled={!ready} onClick={() => { uploadTarget.current = null; fileInput.current.click(); }}><ImagePlus size={18} /> Add picture</button>
        <span className={styles.marginTip}>Double-click empty space to add a note</span>
      </div>
      {ready && !items.length ? <button type="button" className={styles.starter} style={{ width: Math.min(244, bounds.lane - 12) }} onClick={() => add()}>
        <StickyNote size={25} aria-hidden="true" />
        <strong>Start with a thought.</strong>
        <span>Double-click any empty space beside your itinerary to add a note there.</span>
        <span className={styles.starterAction}><Plus size={16} /> Add your first note</span>
        <small>Or click here to start, then drag your note wherever you like.</small>
      </button> : null}
      {items.map(item => card(item))}
      {error ? <div className={styles.error} role="alert">{error}<button onClick={retry}>Retry</button></div> : null}
    </div> : null}
    {open && typeof document !== 'undefined' ? createPortal(<div className="backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" className={styles.dialog} aria-labelledby="planning-desk-title"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
        if (event.key === 'Tab') {
          const controls = [...dialogRef.current.querySelectorAll('button:not(:disabled),input,textarea,[tabindex="0"]')].filter(element => element.offsetParent);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header><div><h2 id="planning-desk-title">Trip planning desk</h2><p>Notes and pictures everyone in this trip can view and edit.</p></div><button type="button" className="btn ghost" aria-label="Close planning desk" onClick={() => setOpen(false)}><X size={18} /></button></header>
      {toolbar}
      {error ? <p className="err" role="alert">{error} <button className="btn sm" onClick={retry}>Retry</button></p> : null}
      <div className={styles.board} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDrop={event => { event.preventDefault(); images(event.dataTransfer.files); }}
        onPaste={event => { if (event.clipboardData.files.length) { event.preventDefault(); images(event.clipboardData.files); } }}>
        {items.length ? items.map(item => card(item, true)) : <div className={styles.empty}><StickyNote size={32} /><h3>Make room for the unplanned.</h3><p>Add a note or drop in a picture.<br />On wide screens, arrange them beside your itinerary.</p><button className="btn" disabled={!ready} onClick={() => add()}>Add your first note</button></div>}
      </div>
      {bounds.wide ? <footer><span>Drag the grip to move · Pull the corner to resize · Drag the top handle to tilt</span><button className="btn" onClick={() => setOpen(false)}>Arrange beside itinerary</button></footer> : null}
    </div></div>, document.body) : null}
  </>;
}
