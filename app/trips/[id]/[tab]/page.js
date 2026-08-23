'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { notFound } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { useTrip } from '@/components/TripProvider';
import { isTripTab, resolveTab } from '@/lib/icons';
import Itinerary from '@/components/Itinerary';
import MapView from '@/components/MapView';
import Budget from '@/components/Budget';
import Packing from '@/components/Packing';
import Notes from '@/components/Notes';
import People from '@/components/People';
import ActivityModal from '@/components/ActivityModal';
import TripModal from '@/components/TripModal';
import { todayISO } from '@/lib/util';
import { placeDetails } from '@/lib/geo';

export default function TripTabPage({ params }) {
  const { id, tab: segment } = use(params);
  if (!isTripTab(segment)) notFound();
  // /people is where Settings used to live, and those links are already out
  // in the world on shared trips.
  const tab = resolveTab(segment);

  const router = useRouter();
  const { supabase, user, fail, pushToast } = useApp();
  const {
    trip, days, activities, packing, members, online, isOwner, setTrip,
    focusReq, clearFocus, intent, clearIntent,
    saveActivity, quickAddActivity, moveActivity, duplicateActivity, deleteActivity,
    setActivityCoords, addActivities, addPackingItems,
    addPacking, updatePacking, deletePacking, saveNotes, removeMember,
  } = useTrip();

  const [editing, setEditing] = useState(null);
  const [opening, setOpening] = useState(''); // the row we are fetching for
  const [tripDraft, setTripDraft] = useState(null);

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
      setTripDraft({ ...trip });
      clearIntent();
    }
  }, [intent, days, trip, clearIntent]);

  if (!trip) return null;

  const shareUrl = trip.share_code && typeof window !== 'undefined'
    ? `${window.location.origin}/join/${trip.share_code}`
    : '';

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
      budget: d.budget === '' || d.budget == null ? null : Number(d.budget),
      updated_at: new Date().toISOString(),
    };
    setTrip((prev) => ({ ...prev, ...payload }));
    setTripDraft(null);
    const { error } = await supabase.from('trips').update(payload).eq('id', trip.id);
    if (error) fail(error); else pushToast('Trip updated.');
  }

  async function deleteTrip() {
    if (!supabase) return;
    const { error } = await supabase.from('trips').delete().eq('id', trip.id);
    if (error) { fail(error); return; }
    pushToast('Trip deleted.');
    router.push('/trips');
  }

  async function leaveTrip() {
    if (!supabase || !user) return;
    const { error } = await supabase.from('trip_members').delete()
      .eq('trip_id', trip.id).eq('user_id', user.id);
    if (error) { fail(error); return; }
    pushToast('You have left the trip.');
    router.push('/trips');
  }

  async function onDuplicate(act) {
    const copy = await duplicateActivity(act);
    if (copy) openEditor(copy);
  }

  return (
    <>
      {tab === 'itinerary' ? (
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
        <Budget trip={trip} days={days} activities={activities}
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

      {tab === 'settings' ? (
        <People members={members} online={online} user={user} isOwner={isOwner}
          shareUrl={shareUrl} onRemove={removeMember}
          onDeleteTrip={deleteTrip} onLeaveTrip={leaveTrip} />
      ) : null}

      {editing ? (
        <ActivityModal draft={editing} days={days} currency={trip.currency}
          onChange={setEditing}
          onSave={(d) => { saveActivity(d); setEditing(null); }}
          onDelete={(d) => { deleteActivity(d); setEditing(null); }}
          onClose={() => setEditing(null)} />
      ) : null}

      {tripDraft ? (
        <TripModal draft={tripDraft} onChange={setTripDraft} onSave={saveTrip}
          onClose={() => setTripDraft(null)} />
      ) : null}
    </>
  );
}
