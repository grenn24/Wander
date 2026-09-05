-- Local-only smoke check. Every fixture is rolled back, including on failure
-- (psql must run with ON_ERROR_STOP=1). Uses the authorised local tester.
begin;
select id as tester from auth.users
where raw_user_meta_data->>'display_name' = 'Notes E2E Tester' limit 1 \gset
select set_config('request.jwt.claim.sub', :'tester', true);
set local role authenticated;
insert into public.trips(owner_id, name, start_date, end_date, timezone)
values (:'tester', 'E2E — travel storage rollback', '2026-09-05', '2026-09-07', 'Asia/Tokyo')
returning id as trip \gset
update public.trips set budget_member_ids = array[:'tester'::uuid] where id = :'trip';
insert into public.activities(trip_id, day, title, category, subtype, start_time, end_time, details)
values (:'trip', '2026-09-05', 'E2E flight', 'transport', 'flight', '23:00', '07:00',
  '{"departure_timezone":"Asia/Singapore","arrival_timezone":"Asia/Tokyo","arrival_date":"2026-09-06"}');
select set_config('wander.test_trip', :'trip', true);
do $$
begin
  if not exists(select 1 from public.trips where id = current_setting('wander.test_trip')::uuid
    and timezone = 'Asia/Tokyo' and budget_member_ids = array[auth.uid()]) then
    raise exception 'Trip zone and split did not persist through authenticated RLS';
  end if;
  if not exists(select 1 from public.activities where trip_id = current_setting('wander.test_trip')::uuid
    and details->>'departure_timezone' = 'Asia/Singapore'
    and details->>'arrival_timezone' = 'Asia/Tokyo' and details->>'arrival_date' = '2026-09-06') then
    raise exception 'Flight endpoint details did not persist';
  end if;
end $$;
rollback;
