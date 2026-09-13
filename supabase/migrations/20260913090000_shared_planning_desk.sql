create table public.trip_desk_items (
  trip_id uuid not null references public.trips(id) on delete cascade,
  id uuid not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (trip_id, id)
);
alter table public.trip_desk_items enable row level security;
grant select, insert, update on public.trip_desk_items to authenticated;
create policy desk_members on public.trip_desk_items for all to authenticated
  using (public.is_trip_member(trip_id))
  with check (public.is_trip_member(trip_id));

-- Merge changed fields atomically: moving a note must not overwrite another
-- member's text. Tombstones prevent stale edits/imports resurrecting deletes.
create function public.save_desk_item(p_trip uuid, p_id uuid, p_patch jsonb,
  p_create boolean default false, p_delete boolean default false)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_trip_member(p_trip) then
    raise insufficient_privilege using message = 'Trip membership required';
  end if;
  if p_create then
    insert into public.trip_desk_items(trip_id, id, payload) values(p_trip, p_id, p_patch)
    on conflict (trip_id, id) do update
      set payload = trip_desk_items.payload || excluded.payload, deleted = false;
  else
    update public.trip_desk_items set payload = payload || p_patch, deleted = p_delete
      where trip_id = p_trip and id = p_id and not deleted;
  end if;
end;
$$;
revoke all on function public.save_desk_item(uuid, uuid, jsonb, boolean, boolean) from public;
grant execute on function public.save_desk_item(uuid, uuid, jsonb, boolean, boolean) to authenticated;
alter table public.trip_desk_items replica identity full;
alter publication supabase_realtime add table public.trip_desk_items;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('planning-desk', 'planning-desk', false, 8388608,
  array['image/jpeg','image/png','image/webp','image/gif']);
create policy desk_pictures_read on storage.objects for select to authenticated
  using (bucket_id = 'planning-desk' and public.is_trip_member(((storage.foldername(name))[1])::uuid));
create policy desk_pictures_add on storage.objects for insert to authenticated
  with check (bucket_id = 'planning-desk' and public.is_trip_member(((storage.foldername(name))[1])::uuid));
