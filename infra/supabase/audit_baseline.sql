-- MyPetNew Supabase baseline audit
-- READ ONLY: this file must not perform DDL or DML.
-- Run with a database identity that can inspect catalogs. Do not commit output containing secrets or customer data.

SELECT
    current_database() AS database_name,
    current_user AS current_user,
    version() AS postgres_version,
    current_setting('server_version') AS server_version,
    current_setting('pgrst.db_schemas', true) AS postgrest_exposed_schemas;

SELECT
    installed_rank,
    version,
    description,
    type,
    checksum,
    success,
    installed_on
FROM mypet.flyway_schema_history
ORDER BY installed_rank;

SELECT
    MAX(version::integer) FILTER (WHERE success AND version ~ '^[0-9]+$') AS latest_successful_version,
    COUNT(*) FILTER (WHERE NOT success) AS failed_migration_count
FROM mypet.flyway_schema_history;

SELECT COUNT(*) AS mypet_table_count
FROM information_schema.tables
WHERE table_schema = 'mypet'
  AND table_type = 'BASE TABLE';

SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    c.reltuples::bigint AS estimated_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname LIKE 'captain_%'
ORDER BY c.relname;

SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE (schemaname = 'public' AND tablename LIKE 'captain_%')
   OR schemaname = 'mypet'
ORDER BY schemaname, tablename, policyname;

SELECT
    r.rolname,
    r.rolsuper,
    r.rolcreaterole,
    r.rolcreatedb,
    r.rolcanlogin,
    r.rolbypassrls
FROM pg_roles r
WHERE r.rolname IN ('mypet_runtime', 'anon', 'authenticated', 'service_role')
   OR r.rolname LIKE 'mypet%'
ORDER BY r.rolname;

SELECT
    grantee,
    table_schema,
    privilege_type,
    COUNT(*) AS privilege_count
FROM information_schema.table_privileges
WHERE table_schema IN ('mypet', 'public')
  AND (grantee IN ('anon', 'authenticated', 'service_role', 'mypet_runtime') OR grantee LIKE 'mypet%')
GROUP BY grantee, table_schema, privilege_type
ORDER BY grantee, table_schema, privilege_type;

SELECT
    extname,
    extversion,
    n.nspname AS schema_name
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
ORDER BY extname;

SELECT
    pubname,
    puballtables,
    pubinsert,
    pubupdate,
    pubdelete,
    pubtruncate
FROM pg_publication
ORDER BY pubname;

SELECT
    p.pubname,
    n.nspname AS schema_name,
    c.relname AS table_name
FROM pg_publication_rel pr
JOIN pg_publication p ON p.oid = pr.prpubid
JOIN pg_class c ON c.oid = pr.prrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
ORDER BY p.pubname, n.nspname, c.relname;

-- Supabase Storage metadata. Absence of rows is a valid baseline before bucket provisioning.
SELECT
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
FROM storage.buckets
ORDER BY id;
