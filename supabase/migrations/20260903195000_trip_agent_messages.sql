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

create index if not exists agent_messages_trip_idx
  on public.trip_agent_messages (trip_id, created_at);

grant select, insert on public.trip_agent_messages to authenticated;

alter table public.trip_agent_messages enable row level security;

drop policy if exists agent_messages_select on public.trip_agent_messages;
create policy agent_messages_select on public.trip_agent_messages for select to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists agent_messages_insert on public.trip_agent_messages;
create policy agent_messages_insert on public.trip_agent_messages for insert to authenticated
  with check (public.is_trip_member(trip_id) and user_id = auth.uid());

alter table public.trip_agent_messages replica identity full;

do $do$
begin
  begin
    alter publication supabase_realtime add table public.trip_agent_messages;
  exception when duplicate_object then null;
  end;
end;
$do$;
