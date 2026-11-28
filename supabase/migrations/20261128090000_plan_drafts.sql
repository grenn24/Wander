-- A trip plan while it is being written, kept on the server so it outlives the
-- browser tab that asked for it.
--
-- A fourteen-day plan takes a minute and a half to write, and browsers put a
-- tab to sleep when someone switches away: Edge's sleeping tabs dropped the
-- connection at day 5 and at day 12 on 28 November 2026, while the server
-- carried on and wrote the whole plan for nobody. Now the server saves each day
-- here as it goes, and the planner page, when its connection is lost, reads
-- the plan from here instead of asking for it again.
--
-- One row per plan request. `plan` is the plan as far as it has got, in the
-- shape the planner page already uses; `status` is
--   running    still being written (updated_at moves with every day)
--   done       finished: `plan` is the whole thing
--   stopped    the server gave up part way; the page asks for the rest
--   cancelled  the traveller pressed Cancel; the server stops writing
--
-- Private to the person who asked. Drafts are scratch: the planner deletes
-- the asker's drafts older than a day each time it starts another.
--
-- Safe to run twice.

create table if not exists public.plan_drafts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  status      text not null default 'running'
              check (status in ('running', 'done', 'stopped', 'cancelled')),
  plan        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists plan_drafts_user_idx
  on public.plan_drafts (user_id, created_at);

grant select, insert, update, delete on public.plan_drafts to authenticated;
alter table public.plan_drafts enable row level security;

drop policy if exists plan_drafts_own on public.plan_drafts;
create policy plan_drafts_own on public.plan_drafts for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
