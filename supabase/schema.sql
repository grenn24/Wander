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

-- ------------------------------------------------- v1 -> v2 column adds ----
alter table public.trip_members add column if not exists display_name text;
alter table public.trips        add column if not exists share_code   text;

-- Place identity, so a stop can be re-resolved and illustrated without asking
-- the geocoder again. photo_ref is a provider photo handle, not a URL: photo
-- URLs are short-lived and are built on demand by /api/places/photo.
alter table public.activities add column if not exists place_id  text;
alter table public.activities add column if not exists photo_ref text;
alter table public.trips      add column if not exists cover_ref text;

create index if not exists activities_trip_day_idx on public.activities (trip_id, day);
create index if not exists packing_trip_idx        on public.packing_items (trip_id);
create index if not exists members_user_idx        on public.trip_members (user_id);

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
  select coalesce(
    nullif(u.raw_user_meta_data ->> 'display_name', ''),
    nullif(u.email, ''),
    'Guest'
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
          coalesce(nullif((select u.raw_user_meta_data ->> 'display_name'
                           from auth.users u where u.id = new.owner_id), ''), 'Guest'),
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

  insert into public.trip_members (trip_id, user_id, display_name, role)
  values (v_trip, auth.uid(), public.my_display_name(), 'editor')
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
-- Only `authenticated` needs them: an anonymous sign-in still yields a real
-- session whose JWT carries role=authenticated (with is_anonymous=true), which
-- is the role every policy below is written for. `anon` — a visitor with no
-- session at all — deliberately gets nothing.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on public.trips, public.trip_members, public.activities, public.packing_items
  to authenticated;

-- --------------------------------------------------------------- row-level ---
alter table public.trips         enable row level security;
alter table public.trip_members  enable row level security;
alter table public.activities    enable row level security;
alter table public.packing_items enable row level security;

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

-- ---------------------------------------------------------------- realtime ---
alter table public.trips         replica identity full;
alter table public.trip_members  replica identity full;
alter table public.activities    replica identity full;
alter table public.packing_items replica identity full;

do $do$
declare t text;
begin
  foreach t in array array['trips','trip_members','activities','packing_items'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when others then null;
    end;
  end loop;
end;
$do$;
