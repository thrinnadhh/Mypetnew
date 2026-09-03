#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# prepare-supabase-postgis.sh
#
# Idempotently configures PostGIS in the Supabase-standard 'extensions' schema.
# Shared between CI ephemeral PostgreSQL and Remote Mac isolated Docker PostgreSQL.
#
# Fails closed if any non-extension user tables or dependent user objects exist.
# ---------------------------------------------------------------------------

CONTAINER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --container)
      CONTAINER="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--container <docker_container_name>]" >&2
      exit 2
      ;;
  esac
done

verify_loopback_host() {
  local host="$1"
  local origin_desc="$2"
  host="${host#[}"
  host="${host%]}"
  case "$host" in
    127.0.0.1|localhost|::1) ;;
    *)
      echo "PostGIS alignment only permits loopback PostgreSQL; received $origin_desc host '$1'." >&2
      exit 2
      ;;
  esac
}

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

verify_loopback_host "$PGHOST" "PGHOST"

if [[ -n "$CONTAINER" ]]; then
  psql_exec=(docker exec -i "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -X -v ON_ERROR_STOP=1)
  psql_query=(docker exec "$CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -X -A -t -v ON_ERROR_STOP=1)
else
  if ! command -v psql >/dev/null 2>&1; then
    echo "psql is required for PostGIS alignment." >&2
    exit 2
  fi
  psql_exec=(psql -X -v ON_ERROR_STOP=1)
  psql_query=(psql -X -A -t -v ON_ERROR_STOP=1)
fi

# 1. Inspect current PostGIS extension state
postgis_namespace="$("${psql_query[@]}" -c "
  SELECT COALESCE((
    SELECT n.nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis'
  ), 'missing');
")"

if [[ "$postgis_namespace" == "extensions" ]]; then
  echo "PostGIS is already aligned in 'extensions' schema."
  exit 0
fi

# 2. If PostGIS exists in a non-extensions schema, check for user tables
if [[ "$postgis_namespace" != "missing" ]]; then
  existing_user_tables="$("${psql_query[@]}" -c "
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
    WHERE c.relkind IN ('r', 'p')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      AND d.objid IS NULL;
  ")"
  if [[ ! "$existing_user_tables" =~ ^[0-9]+$ ]] || (( existing_user_tables != 0 )); then
    echo "PostGIS is in schema '$postgis_namespace' but database contains $existing_user_tables user table(s); refusing destructive extension relocation." >&2
    exit 1
  fi

  # 3. Check for non-extension dependent user objects
  dependent_objects="$("${psql_query[@]}" -c "
    SELECT COUNT(*)
    FROM pg_depend dep
    JOIN pg_extension ext ON dep.refobjid = ext.oid
    JOIN pg_class cls ON dep.objid = cls.oid
    JOIN pg_namespace nsp ON cls.relnamespace = nsp.oid
    WHERE ext.extname IN ('postgis', 'postgis_topology')
      AND dep.deptype != 'e'
      AND nsp.nspname NOT IN ('pg_catalog', 'information_schema');
  ")"
  if [[ ! "$dependent_objects" =~ ^[0-9]+$ ]] || (( dependent_objects != 0 )); then
    echo "PostGIS is in schema '$postgis_namespace' but $dependent_objects user object(s) depend on it; refusing destructive relocation." >&2
    exit 1
  fi

  # 4. Safe relocation: drop and recreate in extensions schema
  "${psql_exec[@]}" >/dev/null <<'SQL'
DROP EXTENSION IF EXISTS postgis_topology CASCADE;
DROP EXTENSION IF EXISTS postgis CASCADE;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION postgis WITH SCHEMA extensions;
SQL

else
  # PostGIS is missing altogether: install directly in extensions schema
  "${psql_exec[@]}" >/dev/null <<'SQL'
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION postgis WITH SCHEMA extensions;
SQL
fi

# 5. Verify PostGIS is now in extensions schema
final_namespace="$("${psql_query[@]}" -c "
  SELECT COALESCE((
    SELECT n.nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'postgis'
  ), 'missing');
")"

if [[ "$final_namespace" != "extensions" ]]; then
  echo "Failed to align PostGIS with Supabase extensions schema; current schema is '$final_namespace'." >&2
  exit 1
fi

echo "PostGIS successfully aligned in 'extensions' schema."
