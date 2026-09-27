-- Covers a trip keeps for itself: one someone uploaded, or one drawn for it.
--
-- A cover used to be a reference to a Google photograph of a place (cover_ref),
-- which is a string and nothing more. A picture of your own is a file, so it
-- lives in storage and the trip holds its path.
--
-- The bucket is public: a cover is drawn in a list of trips, and a private one
-- would need a signed link for every row, which is a request per picture. The
-- paths carry a random name under the trip's id, so they are not guessable and
-- are never listed; only someone on the trip can put one there or take it away.
alter table public.trips add column if not exists cover_path text;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('trip-covers', 'trip-covers', true, 6291456,
  array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reading the row, not the picture: the file itself is public and comes back
-- from a plain URL with no policy involved. This is what lets a member replace
-- a cover — taking the old file away, or copying one to a duplicated trip,
-- both look up the object first, and an object nobody can see is an object
-- nobody can delete.
drop policy if exists trip_covers_read on storage.objects;
create policy trip_covers_read on storage.objects for select to authenticated
  using (bucket_id = 'trip-covers' and public.is_trip_member(((storage.foldername(name))[1])::uuid));

drop policy if exists trip_covers_add on storage.objects;
create policy trip_covers_add on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-covers' and public.is_trip_member(((storage.foldername(name))[1])::uuid));

drop policy if exists trip_covers_replace on storage.objects;
create policy trip_covers_replace on storage.objects for update to authenticated
  using (bucket_id = 'trip-covers' and public.is_trip_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'trip-covers' and public.is_trip_member(((storage.foldername(name))[1])::uuid));

drop policy if exists trip_covers_remove on storage.objects;
create policy trip_covers_remove on storage.objects for delete to authenticated
  using (bucket_id = 'trip-covers' and public.is_trip_member(((storage.foldername(name))[1])::uuid));
