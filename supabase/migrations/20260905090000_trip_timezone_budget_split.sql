-- Existing trips deliberately remain unset: a browser zone is not a destination.
alter table public.trips add column if not exists timezone text;
-- null means all current members; an array is an explicit selection.
alter table public.trips add column if not exists budget_member_ids uuid[];
