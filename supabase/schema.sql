-- ============================================================================
-- Wander — travel itinerary planner  (schema v2: no login, share-link access)
-- Paste this whole file into Supabase → SQL Editor → Run. Safe to re-run,
-- and safe to run on top of v1.
--
-- REQUIRED afterwards: Supabase → Authentication → Sign In / Providers →
-- enable "Anonymous sign-ins". The app creates a guest session on first visit.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables ---
create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  destination text default '',
  start_date  date,
  end_date    date,
  currency    text not null default 'SGD',
  budget      numeric(12,2),
  notes       text default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.trip_members (
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.activities (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day         date not null,
  start_time  time,
  end_time    time,
  title       text not null,
  category    text not null default 'sightseeing',
  location    text default '',
  lat         double precision,
  lng         double precision,
  cost        numeric(12,2) not null default 0,
  booking_ref text default '',
  notes       text default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.packing_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  label      text not null,
  category   text not null default 'general',
  qty        integer not null default 1,
  packed     boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- The private conversation Wander uses to remember how a trip was planned and
-- what its travellers later asked it to change. Messages disappear with the
-- trip and are readable only by people who can already open that trip.
create table if not exists public.trip_agent_messages (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  role       text not null check (role in ('user', 'assistant')),
  kind       text not null default 'message',
  content    text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------- v1 -> v2 column adds ----
alter table public.trip_members add column if not exists display_name text;
alter table public.trips        add column if not exists share_code   text;

-- Place identity, so a stop can be re-resolved and illustrated without asking
-- the geocoder again. photo_ref is a provider photo handle, not a URL: photo
-- URLs are short-lived and are built on demand by /api/places/photo.
alter table public.activities add column if not exists place_id  text;
alter table public.activities add column if not exists photo_ref text;

-- Transport is a parent type, not a leaf. A flight and a bus ride are both
-- "transport" and share almost nothing: one has a terminal, a gate and a seat,
-- the other has a stop and a departure board. The subtype says which, and the
-- fields that only that subtype has live in `details` rather than as twenty
-- mostly-null columns on every activity in the trip.
alter table public.activities add column if not exists subtype text;
alter table public.activities add column if not exists details  jsonb not null default '{}'::jsonb;
alter table public.trips      add column if not exists cover_ref text;
-- A cover of the trip's own: the path of a picture in the trip-covers bucket
-- (supabase/migrations/20260927090000_trip_covers.sql), uploaded or drawn for it.
alter table public.trips      add column if not exists cover_path text;

alter table public.trips add column if not exists timezone text;
alter table public.trips add column if not exists budget_member_ids uuid[];

-- The event this activity became in someone's Google Calendar, so a second
-- sync updates what it wrote the first time instead of adding it all again.
alter table public.activities add column if not exists google_event_id text;

-- ------------------------------------------------------- google calendar ---
-- A long-lived key to somebody's calendar, which is not the same kind of thing
-- as a trip and is not stored like one.
--
-- Row level security is enabled and there are deliberately NO policies: with
-- RLS on and nothing granted, a user's own JWT can neither read nor write this
-- table, and neither can anyone else's. Only the service role reaches it, from
-- route handlers on the server. The browser hands the refresh token over once,
-- at the moment Google issues it, and never sees it again.
create table if not exists public.google_tokens (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  scope         text not null default '',
  updated_at    timestamptz not null default now()
);
alter table public.google_tokens enable row level security;

-- ---------------------------------------------------------- saved places ---
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

-- ------------------------------------------------------------ favourites ---
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

-- -------------------------------------------------------------- journeys ---
-- Trips written as journals. One table is both the catalogue and the journey
-- service's work queue: a row starts as a brief ('queued'), is written and
-- reviewed ('working'), and ends 'published', 'draft' or 'rejected'.
--
-- The one table `anon` can read, and only its published rows: journeys are
-- public pages. Nothing is writable except by the service role the journey
-- service runs with.
create table if not exists public.journeys (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  status       text not null default 'queued'
               check (status in ('queued', 'working', 'draft', 'published', 'rejected', 'archived')),
  source       text not null default 'generated' check (source in ('editorial', 'generated')),
  brief        text not null default '',
  doc          jsonb,
  summary      jsonb,
  review       jsonb not null default '{}'::jsonb,
  version      integer not null default 0,
  attempts     integer not null default 0,
  last_error   text,
  checked_at   timestamptz,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists journeys_status_idx on public.journeys (status, published_at);

alter table public.journeys enable row level security;
grant select on public.journeys to anon, authenticated;
-- Newer Supabase projects no longer grant new tables to the service role by
-- default, and the journey service writes with it.
grant select, insert, update, delete on public.journeys to service_role;
drop policy if exists journeys_read_published on public.journeys;
create policy journeys_read_published on public.journeys for select to anon, authenticated
  using (status = 'published');

create index if not exists activities_trip_day_idx on public.activities (trip_id, day);
create index if not exists packing_trip_idx        on public.packing_items (trip_id);
create index if not exists members_user_idx        on public.trip_members (user_id);
create index if not exists agent_messages_trip_idx on public.trip_agent_messages (trip_id, created_at);

-- ------------------------------------------------------- helper functions ---
create or replace function public.gen_share_code()
returns text language sql volatile as $fn$
  select lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$fn$;

update public.trips set share_code = public.gen_share_code() where share_code is null;
alter table public.trips alter column share_code set default public.gen_share_code();
alter table public.trips alter column share_code set not null;
create unique index if not exists trips_share_code_idx on public.trips (share_code);

-- SECURITY DEFINER so they bypass RLS; this is what stops policy recursion
-- between trips <-> trip_members.
create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql security definer stable
set search_path = public as $fn$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = p_trip and m.user_id = auth.uid()
  );
$fn$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql security definer stable
set search_path = public as $fn$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip and t.owner_id = auth.uid()
  );
$fn$;

create or replace function public.my_display_name()
returns text language sql security definer stable
set search_path = public as $fn$
  -- Their own answer, then whatever the provider supplied (Google sends
  -- full_name), then the address itself. Everyone has an account now, so there
  -- is always something better than a placeholder.
  select coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(u.raw_user_meta_data ->> 'full_name', ''),
    nullif(u.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(u.email, '@', 1), ''),
    'Traveller'
  )
  from auth.users u where u.id = auth.uid();
$fn$;

-- Creating a trip auto-enrols the creator as owner-member.
create or replace function public.add_owner_as_member()
returns trigger language plpgsql security definer
set search_path = public as $fn$
begin
  insert into public.trip_members (trip_id, user_id, display_name, email, role)
  values (new.id, new.owner_id,
          (select coalesce(
             nullif(u.raw_user_meta_data ->> 'display_name', ''),
             nullif(u.raw_user_meta_data ->> 'full_name', ''),
             nullif(u.raw_user_meta_data ->> 'name', ''),
             nullif(split_part(u.email, '@', 1), ''),
             'Traveller')
           from auth.users u where u.id = new.owner_id),
          (select u.email from auth.users u where u.id = new.owner_id),
          'owner')
  on conflict (trip_id, user_id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists trips_add_owner on public.trips;
create trigger trips_add_owner
  after insert on public.trips
  for each row execute function public.add_owner_as_member();

-- Anyone holding a trip's share code becomes an editor on it.
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
  where t.share_code = lower(trim(p_code));

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

grant execute on function public.join_trip_by_code(text) to authenticated, anon;
grant execute on function public.my_display_name() to authenticated, anon;

-- v1 invite machinery is no longer used.
drop function if exists public.claim_my_invites();
drop table if exists public.trip_invites cascade;

-- -------------------------------------------------------------- privileges ---
-- Grants and RLS are two separate gates: a policy can only permit what the
-- role has also been granted, so without these every request comes back 403
-- "permission denied" no matter how permissive the policies are. Newer
-- Supabase versions stopped handing new public tables to anon/authenticated by
-- default, so grant explicitly rather than relying on default privileges.
--
-- Only `authenticated` needs them: that is the role every policy below is
-- written for, and since sign-in became mandatory it is the only role any
-- request to these tables can arrive with. `anon` — a visitor with no session
-- at all — deliberately gets nothing, which is what makes leaving anonymous
-- sign-ins switched off on the project a real boundary rather than a setting.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on public.trips, public.trip_members, public.activities, public.packing_items
  to authenticated;
grant select, insert on public.trip_agent_messages to authenticated;

-- --------------------------------------------------------------- row-level ---
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.activities    enable row level security;
alter table public.packing_items enable row level security;
alter table public.trip_agent_messages enable row level security;

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips for select to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id));

drop policy if exists trips_insert on public.trips;
create policy trips_insert on public.trips for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists trips_update on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (owner_id = auth.uid() or public.is_trip_member(id))
  with check (owner_id = auth.uid() or public.is_trip_member(id));

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
  using (owner_id = auth.uid());

drop policy if exists members_select on public.trip_members;
create policy members_select on public.trip_members for select to authenticated
  using (user_id = auth.uid() or public.is_trip_member(trip_id));

drop policy if exists members_insert on public.trip_members;
create policy members_insert on public.trip_members for insert to authenticated
  with check (public.is_trip_owner(trip_id));

drop policy if exists members_update on public.trip_members;
create policy members_update on public.trip_members for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists members_delete on public.trip_members;
create policy members_delete on public.trip_members for delete to authenticated
  using (public.is_trip_owner(trip_id) or user_id = auth.uid());

drop policy if exists activities_all on public.activities;
create policy activities_all on public.activities for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists packing_all on public.packing_items;
create policy packing_all on public.packing_items for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

drop policy if exists agent_messages_select on public.trip_agent_messages;
create policy agent_messages_select on public.trip_agent_messages for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists agent_messages_insert on public.trip_agent_messages;
create policy agent_messages_insert on public.trip_agent_messages for insert to authenticated
  with check (public.is_trip_member(trip_id) and user_id = auth.uid());

-- ---------------------------------------------------------------- realtime ---
alter table public.trips         replica identity full;
alter table public.trip_members  replica identity full;
alter table public.activities    replica identity full;
alter table public.packing_items replica identity full;
alter table public.trip_agent_messages replica identity full;

do $do$
declare t text;
begin
  foreach t in array array['trips','trip_members','activities','packing_items','trip_agent_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end;
$do$;
