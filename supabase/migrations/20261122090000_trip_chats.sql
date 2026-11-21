-- The trip Assistant's conversations, kept for the person who had them.
--
-- One row per conversation, its turns in `messages` (the page's own shape:
-- role, content, sources, status). Private: only the person who asked can
-- read, rename or delete a conversation, and only while they are still on
-- the trip — a deleted trip, or one they have left, takes their chats out of
-- sight with it (is_trip_member is false for both), without destroying them.
--
-- Unlike trips, a chat is deleted for good: it is one person's notes to
-- themselves, and "delete" should mean it.
--
-- Safe to run twice.

create table if not exists public.trip_chats (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  messages    jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trip_chats_user_trip_idx
  on public.trip_chats (user_id, trip_id, updated_at desc);

grant select, insert, update, delete on public.trip_chats to authenticated;
alter table public.trip_chats enable row level security;

drop policy if exists trip_chats_own on public.trip_chats;
create policy trip_chats_own on public.trip_chats for all to authenticated
  using (user_id = auth.uid() and public.is_trip_member(trip_id))
  with check (user_id = auth.uid() and public.is_trip_member(trip_id));
