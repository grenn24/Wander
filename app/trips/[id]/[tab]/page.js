'use client';

import { use, useState } from 'react';
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
    saveActivity, quickAddActivity, moveActivity, duplicateActivity, deleteActivity,
    setActivityCoords, addActivities, addPackingItems,
    addPacking, updatePacking, deletePacking, saveNotes, removeMember,
  } = useTrip();

  const [editing, setEditing] = useState(null);
  const [tripDraft, setTripDraft] = useState(null);

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
    if (copy) setEditing({ ...copy });
  }

  return (
    <>
      {tab === 'itinerary' ? (
        <Itinerary trip={trip} days={days} activities={activities}
          onAdd={(day, title) => setEditing({ day, title: title || '', category: 'sightseeing', cost: 0 })}
          onEdit={(a) => setEditing({ ...a })}
          onQuickAdd={quickAddActivity}
          onMove={moveActivity}
          onDuplicate={onDuplicate}
          onDelete={deleteActivity}
          onPrint={() => window.print()}
          onAddMany={addActivities}
          onEditTrip={() => setTripDraft({ ...trip })} />
      ) : null}

      {tab === 'map' ? (
        <MapView trip={trip} days={days} activities={activities}
          onEdit={(a) => setEditing({ ...a })}
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
          trip={trip} days={days} activities={activities} onAddMany={addPackingItems} />
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
