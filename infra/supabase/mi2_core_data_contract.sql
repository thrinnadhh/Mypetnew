-- MI-2 — Core data architecture live certification.
-- Read-only assertions only. This file must never create, alter, grant, revoke,
-- insert, update, delete, truncate, or otherwise mutate the target database.

DO $$
DECLARE
    latest_version integer;
    failed_migrations integer;
    bad_runtime_roles integer;
    runtime_owned_tables integer;
    runtime_owned_sequences integer;
    direct_client_grants integer;
    postgis_schema text;
    required_geo_indexes integer;
    invalid_geo_constraints integer;
BEGIN
    IF to_regnamespace('mypet') IS NULL THEN
        RAISE EXCEPTION 'MI2: required mypet schema is missing';
    END IF;

    SELECT COALESCE(MAX(version::integer) FILTER (WHERE success AND version ~ '^[0-9]+$'), 0),
           COUNT(*) FILTER (WHERE NOT success)
      INTO latest_version, failed_migrations
      FROM mypet.flyway_schema_history;

    IF latest_version < 31 OR failed_migrations <> 0 THEN
        RAISE EXCEPTION 'MI2: Flyway state invalid latest=% failed=%', latest_version, failed_migrations;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM mypet.flyway_schema_history
        WHERE version = '31' AND success
    ) THEN
        RAISE EXCEPTION 'MI2: V31 PostGIS/security foundation is not successfully applied';
    END IF;

    SELECT COUNT(*) INTO bad_runtime_roles
    FROM pg_roles
    WHERE rolname = 'mypet_runtime'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls);

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mypet_runtime' AND rolcanlogin)
       OR bad_runtime_roles <> 0 THEN
        RAISE EXCEPTION 'MI2: mypet_runtime role is missing or over-privileged';
    END IF;

    IF has_database_privilege('mypet_runtime', current_database(), 'CREATE')
       OR has_schema_privilege('mypet_runtime', 'mypet', 'CREATE')
       OR NOT has_schema_privilege('mypet_runtime', 'mypet', 'USAGE') THEN
        RAISE EXCEPTION 'MI2: runtime database/schema privileges violate least privilege';
    END IF;

    SELECT COUNT(*) INTO runtime_owned_tables
    FROM pg_tables WHERE schemaname = 'mypet' AND tableowner = 'mypet_runtime';
    SELECT COUNT(*) INTO runtime_owned_sequences
    FROM pg_sequences WHERE schemaname = 'mypet' AND sequenceowner = 'mypet_runtime';
    IF runtime_owned_tables <> 0 OR runtime_owned_sequences <> 0 THEN
        RAISE EXCEPTION 'MI2: runtime role owns application objects tables=% sequences=%',
            runtime_owned_tables, runtime_owned_sequences;
    END IF;

    SELECT COUNT(*) INTO direct_client_grants
    FROM information_schema.role_table_grants
    WHERE table_schema = 'mypet' AND grantee IN ('anon', 'authenticated');
    IF direct_client_grants <> 0 THEN
        RAISE EXCEPTION 'MI2: direct Supabase client roles have mypet grants=%', direct_client_grants;
    END IF;

    SELECT n.nspname INTO postgis_schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis';
    IF postgis_schema IS DISTINCT FROM 'extensions' THEN
        RAISE EXCEPTION 'MI2: PostGIS must live in extensions schema, found %', postgis_schema;
    END IF;

    SELECT COUNT(*) INTO required_geo_indexes
    FROM pg_indexes
    WHERE schemaname = 'mypet'
      AND indexname IN ('idx_provider_outlet_dispatch_geog', 'idx_service_region_center_geog')
      AND indexdef ILIKE '%USING gist%';
    IF required_geo_indexes <> 2 THEN
        RAISE EXCEPTION 'MI2: expected two evidence-backed geography GiST indexes, found %', required_geo_indexes;
    END IF;

    SELECT COUNT(*) INTO invalid_geo_constraints
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'mypet'
      AND c.conname IN ('chk_provider_dispatch_coordinates', 'chk_service_region_center_coordinates')
      AND NOT c.convalidated;
    IF invalid_geo_constraints <> 0 THEN
        RAISE EXCEPTION 'MI2: geography coordinate constraints are not validated';
    END IF;
END
$$;

SELECT 'MI2_CORE_DATA_CONTRACT_OK' AS certification;
