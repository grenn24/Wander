-- Favourites: trips and journeys someone wants to keep close. A trip they are
-- on, whatever its dates, or a journey by its slug. They belong to a person
-- rather than a trip — favouriting a shared trip marks it for you, not for
-- everyone on it — so only the person who made one can see it.
create table if not exists public.favourites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id    uuid references public.trips(id) on delete cascade,
  journey    text,
  created_at timestamptz not null default now(),
  -- One thing per favourite: a trip or a journey, never both, never neither.
  constraint favourites_one_thing check ((trip_id is null) <> (journey is null))
);
create unique index if not exists favourites_user_trip_idx
  on public.favourites (user_id, trip_id) where trip_id is not null;
create unique index if not exists favourites_user_journey_idx
  on public.favourites (user_id, journey) where journey is not null;

alter table public.favourites enable row level security;
grant select, insert, delete on public.favourites to authenticated;
drop policy if exists favourites_read_own on public.favourites;
create policy favourites_read_own on public.favourites for select to authenticated
  using (user_id = auth.uid());
drop policy if exists favourites_delete_own on public.favourites;
create policy favourites_delete_own on public.favourites for delete to authenticated
  using (user_id = auth.uid());
-- A trip can only be favourited by someone on it.
drop policy if exists favourites_insert_own on public.favourites;
create policy favourites_insert_own on public.favourites for insert to authenticated
  with check (user_id = auth.uid() and (trip_id is null or public.is_trip_member(trip_id)));

-- Want to go is replaced by favourites. Journeys saved as want to go become
-- favourite journeys; places saved as want to go are left as they are, since
-- a favourite is a trip or a journey and a single place is neither.
insert into public.favourites (user_id, journey, created_at)
select user_id, journey, created_at from public.saved_places
where kind = 'want' and journey is not null
on conflict do nothing;
delete from public.saved_places where kind = 'want' and journey is not null;
