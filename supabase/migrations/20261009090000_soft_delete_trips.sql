-- Deleting a trip hides it; nothing is destroyed.
--
-- A deleted trip keeps its row, its activities, its packing list, its covers
-- and its members, and every one of them stays where it was. `deleted_at` is
-- the only thing that changes, and everything that reads a trip treats a row
-- with it set as not there. Nobody holding an API key can delete a trip for
-- good: the DELETE privilege on public.trips is revoked, and so is the policy
-- that used to allow it.
--
-- The one way to delete a trip is public.delete_trip(), because a plain UPDATE
-- cannot do it. A row that has stopped being visible fails the SELECT policy
-- that is checked against an updated row ("new row violates row-level security
-- policy"), so the same rule that hides deleted trips would also forbid
-- deleting one. A function that runs as its owner can set the column, and it
-- checks for itself that the caller owns the trip.
--
-- Safe to run twice.

alter table public.trips add column if not exists deleted_at timestamptz;

-- ------------------------------------------------------ who counts as who ---
-- A trip that has been deleted has no members and no owner. These two are what
-- the policies on every table that hangs off a trip ask, so one change here
-- closes activities, packing, the agent's messages, the planning desk, favourites
-- and the cover and desk-picture storage buckets together.
create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql security definer stable
set search_path = public as $fn$
  select exists (
    select 1
    from public.trip_members m
    join public.trips t on t.id = m.trip_id
    where m.trip_id = p_trip and m.user_id = auth.uid() and t.deleted_at is null
  );
$fn$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql security definer stable
set search_path = public as $fn$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip and t.owner_id = auth.uid() and t.deleted_at is null
  );
$fn$;

-- An old share link to a deleted trip says it is not valid, rather than
-- quietly adding someone to a trip they can no longer open. This runs as its
-- owner and so is not held back by the policies below; it has to check.
create or replace function public.join_trip_by_code(p_code text)
returns uuid language plpgsql security definer
set search_path = public as $fn$
declare
  v_trip uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  select t.id into v_trip from public.trips t
  where t.share_code = lower(trim(p_code)) and t.deleted_at is null;

  if v_trip is null then
    raise exception 'That share link is not valid.';
  end if;

  -- Email too: everyone has an account now, so a member list can say who
  -- someone actually is rather than showing a name with nothing behind it.
  insert into public.trip_members (trip_id, user_id, display_name, email, role)
  values (v_trip, auth.uid(), public.my_display_name(),
          (select u.email from auth.users u where u.id = auth.uid()), 'editor')
  on conflict (trip_id, user_id) do nothing;

  return v_trip;
end;
$fn$;

-- ----------------------------------------------------------- deleting one ---
-- Only the owner, as before. A trip that is already deleted, or was never
-- there, is refused the same way as one that belongs to somebody else.
create or replace function public.delete_trip(p_trip uuid)
returns void language plpgsql security definer
set search_path = public as $fn$
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;

  update public.trips
     set deleted_at = now(), updated_at = now()
   where id = p_trip and owner_id = auth.uid() and deleted_at is null;

  if not found then
    raise exception 'Only the owner can delete a trip.' using errcode = '42501';
  end if;
end;
$fn$;

revoke all on function public.delete_trip(uuid) from public;
grant execute on function public.delete_trip(uuid) to authenticated;

-- --------------------------------------------------------- the trips table ---
-- Deleted rows are invisible, and cannot be edited through a normal UPDATE
-- either, so a member cannot delete a trip by setting the column themselves
-- and nobody can bring one back that way. (The WITH CHECK is what says so; the
-- SELECT policy would happen to refuse it too, but that is not worth leaning on.)
drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.is_trip_member(id)));

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (deleted_at is null and (owner_id = auth.uid() or public.is_trip_member(id)))
  with check (deleted_at is null and (owner_id = auth.uid() or public.is_trip_member(id)));

-- No hard delete: no policy that allows it, and no privilege to ask for one.
drop policy if exists trips_delete on public.trips;
revoke delete on public.trips from anon, authenticated;
