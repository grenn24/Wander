'use client';

import { use, useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { notFound } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import { isTripTab, resolveTab } from '@/lib/icons';
import Itinerary from '@/components/Itinerary';
import { removeDownload } from '@/public/offline-store';

/*
 * A trip opens on its itinerary, so that is the only tab whose code is part of
 * the page. The map alone is as much again — it carries Google's map, the
 * routes and the picking — and budget, packing, notes and the editors are all
 * paid for on a screen nobody has asked for yet. Each is fetched when it is
 * opened; they are rendered on the server as before.
 */
const MapView = dynamic(() => retryImport(() => import('@/components/MapView')));
const Budget = dynamic(() => retryImport(() => import('@/components/Budget')));
const Packing = dynamic(() => retryImport(() => import('@/components/Packing')));
const Notes = dynamic(() => retryImport(() => import('@/components/Notes')));
const People = dynamic(() => retryImport(() => import('@/components/People')));
const CalendarLink = dynamic(() => retryImport(() => import('@/components/CalendarLink')));
const OfflineDownload = dynamic(() => retryImport(() => import('@/components/OfflineDownload')));
const ActivityModal = dynamic(() => retryImport(() => import('@/components/ActivityModal')));
const TripModal = dynamic(() => retryImport(() => import('@/components/TripModal')));
import useKept from '@/components/useKept';
import { retryImport } from '@/lib/chunkRetry';
import { todayISO } from '@/lib/util';
import { COVER_BUCKET } from '@/lib/tripCover';
import { placeDetails } from '@/lib/geo';

export default function TripTabPage({ params }) {
  const { id, tab: segment } = use(params);
  if (!isTripTab(segment)) notFound();
  // Keep old /settings and /people links as entry points to the unified editor.
  const tab = resolveTab(segment);

  const router = useRouter();
  const { supabase, user, fail, pushToast } = useApp();
  const {
    trip, days, activities, packing, members, online, isOwner,
    focusReq, clearFocus, intent, clearIntent,
    saveActivity, quickAddActivity, moveActivity, duplicateActivity, deleteActivity,
    setActivityCoords, addActivities, addPackingItems,
    addPacking, updatePacking, deletePacking, saveNotes, removeMember, updateTrip, setTrip,
  } = useTrip();

  const [editing, setEditing] = useState(null);
  const [opening, setOpening] = useState(''); // the row we are fetching for
  const [tripDraft, setTripDraft] = useState(null);
  const [tripSection, setTripSection] = useState(segment === 'people' ? 'people' : 'details');
  // Dialogs stay on screen long enough to play their way out.
  const editingShown = useKept(editing);
  const tripShown = useKept(tripDraft || (tab === 'settings' ? trip : null));

  /*
   * Open the editor with the place already in hand.
   *
   * The pictures, the rating and the reviews all arrive on one Place Details
   * call made from inside the modal, so the modal used to appear at the height
   * of a form with an empty panel beside it and then jump — twice — as the
   * photographs and then the reviews landed under it. Half a second of nothing
   * is a better thing to give someone than a dialog that grows while they are
   * reading it.
   *
   * The call is cached per tab, so this waits once per place and never again;
   * and it is a race rather than an await, because a slow lookup must not be
   * able to make the editor feel broken. Whatever has not arrived by then
   * arrives late, the way it used to.
   */
  const HOLD = 1200;
  const openEditor = useCallback(async (a) => {
    const draft = { ...a };
    if (!draft.place_id) { setEditing(draft); return; }
    setOpening(String(a.id || ''));
    await Promise.race([
      placeDetails(draft.place_id).catch(() => null),
      new Promise((done) => { setTimeout(done, HOLD); }),
    ]);
    setOpening('');
    setEditing(draft);
  }, []);

  /*
   * Requests from the chrome, carried out here.
   *
   * The command bar sits above the page and can be opened from any tab, but
   * the editors are this page's — so it asks, and this answers. Packing is the
   * exception: it has no modal, only a form on its own tab, so the request
   * rides along to the list itself.
   */
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === 'activity') {
      setEditing({
        day: days[0] || null, title: '', category: 'sightseeing', cost: 0,
        ...(intent.seed || {}),
      });
      clearIntent();
    } else if (intent.kind === 'trip' && trip) {
      setTripSection(intent.seed?.section || 'details');
      setTripDraft({ ...trip });
      clearIntent();
    }
  }, [intent, days, trip, clearIntent]);

  if (!trip) return null;

  const shareUrl = trip.share_code && typeof window !== 'undefined'
    ? `${window.location.origin}/join/${trip.share_code}`
    : '';

  function closeTripEditor() {
    setTripDraft(null);
    setTripSection('details');
    if (tab === 'settings') router.replace(`/trips/${id}/itinerary`);
  }

  async function saveTrip(d) {
    if (!supabase) return;
    const start = d.start_date || todayISO();
    const end = d.end_date && d.end_date >= start ? d.end_date : start;
    const payload = {
      name: (d.name || '').trim() || 'Untitled trip',
      destination: d.destination || '',
      start_date: start,
      end_date: end,
      currency: d.currency || 'SGD',
      timezone: d.timezone || null,
      budget: d.budget === '' || d.budget == null ? null : Number(d.budget),
      updated_at: new Date().toISOString(),
    };
    if (await updateTrip(payload)) {
      closeTripEditor();
      pushToast('Trip updated.');
    }
  }

  async function deleteTrip() {
    if (!supabase) return;
    // The cover first: taking it away is allowed to a member of this trip, and
    // in a moment there will be no trip to be a member of.
    if (trip.cover_path) {
      try { await supabase.storage.from(COVER_BUCKET).remove([trip.cover_path]); } catch { /* left behind */ }
    }
    const { error } = await supabase.from('trips').delete().eq('id', trip.id);
    if (error) { fail(error); return; }
    await removeDownload(trip.id).catch(() => {});
    pushToast('Trip deleted.');
    router.push('/trips');
  }

  async function leaveTrip() {
    if (!supabase || !user) return;
    const { error } = await supabase.from('trip_members').delete()
      .eq('trip_id', trip.id).eq('user_id', user.id);
    if (error) { fail(error); return; }
    pushToast('You have left the trip.');
    await removeDownload(trip.id).catch(() => {});
    router.push('/trips');
  }

  async function onDuplicate(act) {
    const copy = await duplicateActivity(act);
    if (copy) openEditor(copy);
  }

  return (
    <>
      {tab === 'itinerary' || tab === 'settings' ? (
        <Itinerary trip={trip} days={days} activities={activities}
          onAdd={(day, title) => setEditing({ day, title: title || '', category: 'sightseeing', cost: 0 })}
          onEdit={openEditor}
          opening={opening}
          onQuickAdd={quickAddActivity}
          onMove={moveActivity}
          onDuplicate={onDuplicate}
          onDelete={deleteActivity}
          onPrint={() => window.print()}
          onAddMany={addActivities}
          focus={focusReq}
          onFocused={clearFocus}
          onEditTrip={() => setTripDraft({ ...trip })} />
      ) : null}

      {tab === 'map' ? (
        <MapView trip={trip} days={days} activities={activities}
          onEdit={openEditor}
          opening={opening}
          onNewAt={(draft) => setEditing(draft)}
          onSetCoords={setActivityCoords}
        />
      ) : null}

      {tab === 'budget' ? (
        <Budget trip={trip} days={days} activities={activities} members={members}
          onSplitChange={(budget_member_ids) => updateTrip({ budget_member_ids })}
          onEditTrip={() => setTripDraft({ ...trip })} />
      ) : null}

      {tab === 'packing' ? (
        <Packing items={packing} onAdd={addPacking} onUpdate={updatePacking} onDelete={deletePacking}
          trip={trip} days={days} activities={activities} onAddMany={addPackingItems}
          focusAdd={intent && intent.kind === 'packing' ? intent.at : null}
          onFocused={clearIntent} />
      ) : null}

      {tab === 'notes' ? (
        <Notes trip={trip} activities={activities} onSave={saveNotes} />
      ) : null}

      {editingShown.value ? (
        <ActivityModal draft={editingShown.value} leaving={editingShown.leaving} days={days} currency={trip.currency}
          onChange={setEditing}
          onSave={(d) => { saveActivity(d); setEditing(null); }}
          onDelete={(d) => { deleteActivity(d); setEditing(null); }}
          onClose={() => setEditing(null)} />
      ) : null}

      {tripShown.value ? (
        <TripModal draft={tripShown.value} leaving={tripShown.leaving} onChange={setTripDraft} onSave={saveTrip}
          // The cover is already saved when it changes, so the page behind the
          // dialog takes it at once — not on Save, and not on a reload. Cancel
          // must not leave the header pointing at a file that has been replaced.
          onCover={(patch) => setTrip((prev) => (prev ? { ...prev, ...patch } : prev))}
          onClose={closeTripEditor} initialSection={tripSection}
          sections={[
            { id: 'people', label: 'Travellers', content: <People compact members={members} online={online}
              user={user} isOwner={isOwner} shareUrl={shareUrl} onRemove={removeMember}
              onDeleteTrip={deleteTrip} onLeaveTrip={leaveTrip} /> },
            { id: 'offline', label: 'Offline', content: <OfflineDownload /> },
            { id: 'calendar', label: 'Calendar', content: <CalendarLink mode="trip" trip={trip}
              synced={activities.some((a) => a.google_event_id)} /> },
          ]} />
      ) : null}
    </>
  );
}
