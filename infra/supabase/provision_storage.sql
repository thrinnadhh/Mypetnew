-- MyPetNew Supabase Storage bucket contract.
--
-- This is Supabase infrastructure configuration, not application-schema Flyway DDL.
-- Run only after the Phase 2 backup/readiness gate.
--
-- Security model:
--   * catalog-media is public READ because the backend returns public object URLs.
--   * provider-verification-private is private.
--   * no anon/authenticated object-write policies are created for either bucket.
--   * Spring Boot uses the server-side service-role credential and therefore remains
--     the only application write/delete authority.

begin;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'catalog-media',
  'catalog-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'provider-verification-private',
  'provider-verification-private',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;

-- Expected configuration evidence.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('catalog-media', 'provider-verification-private')
order by id;

-- Expected client-write policy result: zero rows for these buckets. Service-role access
-- does not require client RLS policies and should remain backend-only.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    coalesce(qual, '') like '%catalog-media%'
    or coalesce(with_check, '') like '%catalog-media%'
    or coalesce(qual, '') like '%provider-verification-private%'
    or coalesce(with_check, '') like '%provider-verification-private%'
  );
