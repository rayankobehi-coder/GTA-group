update storage.buckets
set file_size_limit = 15728640
where id = 'gta-documents';

update storage.buckets
set file_size_limit = 1048576
where id = 'gta-avatars';
