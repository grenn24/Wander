-- Run against local Supabase with psql -v ON_ERROR_STOP=1. No fixtures survive.
begin;
create temporary table desk_test_ids as select gen_random_uuid() owner_id,
  gen_random_uuid() member_id, gen_random_uuid() outsider_id,
  gen_random_uuid() trip_id, gen_random_uuid() item_id;
grant select on desk_test_ids to authenticated;
insert into auth.users(id, email) select owner_id, owner_id || '@desk.test' from desk_test_ids
union all select member_id, member_id || '@desk.test' from desk_test_ids
union all select outsider_id, outsider_id || '@desk.test' from desk_test_ids;
insert into public.trips(id, owner_id, name) select trip_id, owner_id, 'Desk test' from desk_test_ids;
insert into public.trip_members(trip_id, user_id) select trip_id, member_id from desk_test_ids;

set local role authenticated;
select set_config('request.jwt.claim.sub', owner_id::text, true) from desk_test_ids;
select public.save_desk_item(trip_id, item_id, '{"kind":"note","text":"Owner text","x":0.2}', true) from desk_test_ids;
insert into storage.objects(bucket_id, name)
  select 'planning-desk', trip_id || '/' || item_id from desk_test_ids;

select set_config('request.jwt.claim.sub', member_id::text, true) from desk_test_ids;
do $$ begin
  if (select count(*) from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids)) <> 1 then
    raise exception 'Member cannot read shared note'; end if;
  if (select count(*) from storage.objects where name = (select trip_id || '/' || item_id from desk_test_ids)) <> 1 then
    raise exception 'Member cannot read private photo'; end if;
end $$;
select public.save_desk_item(trip_id, item_id, '{"x":0.8}') from desk_test_ids;
do $$ begin
  if not exists(select from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids)
    and payload->>'text' = 'Owner text' and payload->>'x' = '0.8') then
    raise exception 'Position update overwrote text'; end if;
end $$;

select set_config('request.jwt.claim.sub', outsider_id::text, true) from desk_test_ids;
do $$ begin
  if exists(select from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids)) then
    raise exception 'Outsider can read notes'; end if;
  if exists(select from storage.objects where name = (select trip_id || '/' || item_id from desk_test_ids)) then
    raise exception 'Outsider can read pictures'; end if;
  begin
    perform public.save_desk_item(trip_id, item_id, '{"text":"Intruder"}', true) from desk_test_ids;
    raise exception 'Outsider can write notes';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) select 'planning-desk', trip_id || '/intruder' from desk_test_ids;
    raise exception 'Outsider can add pictures';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', owner_id::text, true) from desk_test_ids;
select public.save_desk_item(trip_id, item_id, '{}', false, true) from desk_test_ids;
select public.save_desk_item(trip_id, item_id, '{"text":"Stale edit"}') from desk_test_ids;
insert into public.trip_desk_items(trip_id, id, payload)
  select trip_id, item_id, '{"text":"Stale local import"}' from desk_test_ids
  on conflict(trip_id,id) do nothing;
do $$ begin
  if not exists(select from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids)
    and deleted and payload->>'text' = 'Owner text') then raise exception 'Deleted note resurrected'; end if;
end $$;
select public.save_desk_item(trip_id, item_id, '{"text":"Restored"}', true) from desk_test_ids;
do $$ begin
  if not exists(select from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids)
    and not deleted and payload->>'text' = 'Restored') then raise exception 'Undo failed'; end if;
end $$;

reset role;
delete from public.trip_members where trip_id = (select trip_id from desk_test_ids) and user_id = (select member_id from desk_test_ids);
set local role authenticated;
select set_config('request.jwt.claim.sub', member_id::text, true) from desk_test_ids;
do $$ begin
  if exists(select from public.trip_desk_items where trip_id = (select trip_id from desk_test_ids))
    or exists(select from storage.objects where name = (select trip_id || '/' || item_id from desk_test_ids)) then
    raise exception 'Removed member retains access'; end if;
end $$;
reset role;
do $$ begin
  if (select public from storage.buckets where id = 'planning-desk') then raise exception 'Bucket is public'; end if;
  if not exists(select from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'trip_desk_items') then
    raise exception 'Realtime not enabled'; end if;
end $$;
rollback;
select 'Shared desk access, merge, delete, undo and photo policies passed' as result;
