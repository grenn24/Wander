-- Journeys are called guides.
--
-- Nothing about them changed: the same catalogue, the same rows, the same work
-- queue. The word did. "Guide" is what a curated multi-day itinerary is called
-- everywhere else, and it is short enough for the nav and plain enough for
-- someone arriving for the first time.
--
-- So this renames rather than rebuilds: the table, the two columns elsewhere
-- that point at one by slug, and the indexes, constraints and policy that carry
-- the old word in their own names — so a database that has been through this
-- looks exactly like one built from schema.sql today.
--
-- Every step asks first, so running this twice is not an error.
do $$
begin
  if to_regclass('public.journeys') is not null and to_regclass('public.guides') is null then
    alter table public.journeys rename to guides;
  end if;

  if exists (select 1 from pg_policies
             where schemaname = 'public' and tablename = 'guides'
               and policyname = 'journeys_read_published') then
    alter policy journeys_read_published on public.guides rename to guides_read_published;
  end if;

  if exists (select 1 from pg_constraint where conname = 'journeys_slug_check') then
    alter table public.guides rename constraint journeys_slug_check to guides_slug_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'journeys_status_check') then
    alter table public.guides rename constraint journeys_status_check to guides_status_check;
  end if;
  if exists (select 1 from pg_constraint where conname = 'journeys_source_check') then
    alter table public.guides rename constraint journeys_source_check to guides_source_check;
  end if;

  -- A pin and a favourite each name the guide they came from by its slug.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'saved_places' and column_name = 'journey') then
    alter table public.saved_places rename column journey to guide;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'favourites' and column_name = 'journey') then
    alter table public.favourites rename column journey to guide;
  end if;
end $$;

-- Indexes keep their own names through a table rename, so they are told too.
alter index if exists public.journeys_pkey                  rename to guides_pkey;
alter index if exists public.journeys_slug_key              rename to guides_slug_key;
alter index if exists public.journeys_status_idx            rename to guides_status_idx;
alter index if exists public.saved_places_user_journey_idx  rename to saved_places_user_guide_idx;
alter index if exists public.favourites_user_journey_idx    rename to favourites_user_guide_idx;

-- The service role still writes the catalogue; the grant followed the rename,
-- but say it again for a database that was given the table some other way.
grant select on public.guides to anon, authenticated;
grant select, insert, update, delete on public.guides to service_role;
