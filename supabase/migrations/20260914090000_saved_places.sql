-- The globe: places someone has been, from before Wander or outside it, and
-- places they want to go. They belong to a person rather than a trip, so only
-- the person who saved them can see them.
create table if not exists public.saved_places (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('want', 'been')),
  name       text not null,
  label      text not null default '',
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  place_id   text,
  photo_ref  text,
  journey    text,
  created_at timestamptz not null default now()
);
create index if not exists saved_places_user_idx on public.saved_places (user_id, created_at);
-- One pin per place and per journey: saving twice moves it rather than doubling it.
create unique index if not exists saved_places_user_place_idx
  on public.saved_places (user_id, place_id) where place_id is not null;
create unique index if not exists saved_places_user_journey_idx
  on public.saved_places (user_id, journey) where journey is not null;

alter table public.saved_places enable row level security;
grant select, insert, update, delete on public.saved_places to authenticated;
drop policy if exists saved_places_own on public.saved_places;
create policy saved_places_own on public.saved_places for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
