-- Run against local Supabase with psql -v ON_ERROR_STOP=1. No fixtures survive.
--   docker exec -i supabase_db_wander-planner psql -U postgres -d postgres -v ON_ERROR_STOP=1 < tests/soft-delete-trips.integration.sql
begin;
create temporary table del_test_ids as select gen_random_uuid() owner_id,
  gen_random_uuid() member_id, gen_random_uuid() outsider_id,
  gen_random_uuid() trip_id, gen_random_uuid() keep_id, 'x' as share_code;
grant select on del_test_ids to authenticated;
insert into auth.users(id, email) select owner_id, owner_id || '@del.test' from del_test_ids
union all select member_id, member_id || '@del.test' from del_test_ids
union all select outsider_id, outsider_id || '@del.test' from del_test_ids;
insert into public.trips(id, owner_id, name) select trip_id, owner_id, 'Soft delete test' from del_test_ids;
insert into public.trips(id, owner_id, name) select keep_id, owner_id, 'Soft delete bystander' from del_test_ids;
insert into public.trip_members(trip_id, user_id) select trip_id, member_id from del_test_ids;
insert into public.activities(trip_id, day, title) select trip_id, '2026-10-09', 'Under a deleted trip' from del_test_ids;
insert into public.packing_items(trip_id, label) select trip_id, 'Passport' from del_test_ids;
update del_test_ids set share_code = (select share_code from public.trips where id = trip_id);

-- ------------------------------------------------ a member cannot delete it ---
set local role authenticated;
select set_config('request.jwt.claim.sub', member_id::text, true) from del_test_ids;
do $$ begin
  begin
    perform public.delete_trip(trip_id) from del_test_ids;
    raise exception 'A member deleted the owner''s trip';
  exception when insufficient_privilege then null; end;

  -- Setting the column through a plain UPDATE is the other way to try.
  begin
    update public.trips set deleted_at = now() where id = (select trip_id from del_test_ids);
    raise exception 'A member soft-deleted a trip with a plain UPDATE';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', outsider_id::text, true) from del_test_ids;
do $$ begin
  begin
    perform public.delete_trip(trip_id) from del_test_ids;
    raise exception 'A stranger deleted the trip';
  exception when insufficient_privilege then null; end;
end $$;

-- ------------------------------------------------- nobody hard-deletes one ---
select set_config('request.jwt.claim.sub', owner_id::text, true) from del_test_ids;
do $$ begin
  begin
    delete from public.trips where id = (select trip_id from del_test_ids);
    raise exception 'The owner hard-deleted a trip';
  exception when insufficient_privilege then null; end;
end $$;
do $$ begin
  if not exists(select from public.trips where id = (select trip_id from del_test_ids)) then
    raise exception 'The trip vanished before anyone deleted it'; end if;
end $$;

-- ---------------------------------------------------- the owner deletes it ---
select public.delete_trip(trip_id) from del_test_ids;
do $$ begin
  if exists(select from public.trips where id = (select trip_id from del_test_ids)) then
    raise exception 'Owner still sees the trip they deleted'; end if;
  if not exists(select from public.trips where id = (select keep_id from del_test_ids)) then
    raise exception 'Deleting one trip hid another'; end if;
  if exists(select from public.activities where trip_id = (select trip_id from del_test_ids))
    or exists(select from public.packing_items where trip_id = (select trip_id from del_test_ids)) then
    raise exception 'Owner still reads the contents of a deleted trip'; end if;
  begin
    perform public.delete_trip(trip_id) from del_test_ids;
    raise exception 'A trip was deleted twice';
  exception when insufficient_privilege then null; end;

  -- Neither editing nor restoring it works through a plain UPDATE: the row is not there to touch.
  update public.trips set name = 'Edited after delete' where id = (select trip_id from del_test_ids);
  update public.trips set deleted_at = null where id = (select trip_id from del_test_ids);
end $$;

select set_config('request.jwt.claim.sub', member_id::text, true) from del_test_ids;
do $$ begin
  if exists(select from public.trips where id = (select trip_id from del_test_ids)) then
    raise exception 'Member still sees a deleted trip'; end if;
  if exists(select from public.activities where trip_id = (select trip_id from del_test_ids))
    or exists(select from public.packing_items where trip_id = (select trip_id from del_test_ids)) then
    raise exception 'Member still reads the contents of a deleted trip'; end if;
  begin
    insert into public.activities(trip_id, day, title)
      select trip_id, '2026-10-10', 'Added after delete' from del_test_ids;
    raise exception 'Member added to a deleted trip';
  exception when insufficient_privilege then null; end;
end $$;

-- An old share link to it is not valid any more.
select set_config('request.jwt.claim.sub', outsider_id::text, true) from del_test_ids;
do $$ begin
  begin
    perform public.join_trip_by_code(share_code) from del_test_ids;
    raise exception 'A share link joined a deleted trip';
  exception when others then
    if sqlerrm <> 'That share link is not valid.' then raise; end if;
  end;
end $$;

-- ----------------------------------------- everything is still in the table ---
reset role;
do $$ begin
  if not exists(select from public.trips where id = (select trip_id from del_test_ids)
      and deleted_at is not null and name = 'Soft delete test') then
    raise exception 'The deleted trip was changed or destroyed'; end if;
  if not exists(select from public.activities where trip_id = (select trip_id from del_test_ids)
      and title = 'Under a deleted trip') then
    raise exception 'The deleted trip lost its activities'; end if;
  if not exists(select from public.packing_items where trip_id = (select trip_id from del_test_ids))
    or (select count(*) from public.trip_members where trip_id = (select trip_id from del_test_ids)) <> 2 then
    raise exception 'The deleted trip lost its packing list or members'; end if;

  -- Not by policy alone: the privilege itself is gone, and so is the policy.
  if has_table_privilege('authenticated', 'public.trips', 'DELETE')
    or has_table_privilege('anon', 'public.trips', 'DELETE') then
    raise exception 'DELETE is still granted on public.trips'; end if;
  if exists(select from pg_policies where schemaname = 'public' and tablename = 'trips' and cmd = 'DELETE') then
    raise exception 'A DELETE policy is still on public.trips'; end if;
end $$;

-- ------------------------------------------ and the live ones are unharmed ---
set local role authenticated;
select set_config('request.jwt.claim.sub', owner_id::text, true) from del_test_ids;
update public.trips set name = 'Renamed' where id = (select keep_id from del_test_ids);
insert into public.trips(owner_id, name) select owner_id, 'Made after' from del_test_ids;
do $$ begin
  if not exists(select from public.trips where id = (select keep_id from del_test_ids) and name = 'Renamed')
    or not exists(select from public.trips where name = 'Made after') then
    raise exception 'Live trips can no longer be edited or made'; end if;
end $$;
rollback;
select 'Soft delete: owner-only, nothing destroyed, hidden everywhere, no hard delete passed' as result;
