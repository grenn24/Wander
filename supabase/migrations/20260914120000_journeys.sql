-- Journeys: trips written as journals, for anyone to read once published.
--
-- One table is both the catalogue and the journey service's work queue: a row
-- starts as a brief ('queued'), is written and reviewed ('working'), and ends
-- 'published', 'draft' (held back by review or waiting for photographs) or
-- 'rejected'. Refreshing a journey updates the same row.
--
-- Anyone may read a published row; nothing else is readable, and nothing at all
-- is writable, except by the service role the journey service runs with.
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
