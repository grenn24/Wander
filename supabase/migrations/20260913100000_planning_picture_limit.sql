-- Existing pictures remain readable. New uploads use the post-compression cap.
update storage.buckets set file_size_limit = 6291456 where id = 'planning-desk';
