#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-}"

verify_loopback_host() {
  local host="$1"
  local origin_desc="$2"
  host="${host#[}"
  host="${host%]}"
  case "$host" in
    127.0.0.1|localhost|::1) ;;
    *)
      echo "Ephemeral DB verification only permits loopback PostgreSQL; received $origin_desc host '$1'." >&2
      exit 2
      ;;
  esac
}

if [[ -n "${DATABASE_URL:-}" ]]; then
  if [[ "$DATABASE_URL" == *","* ]]; then
    echo "Ephemeral DB verification strictly forbids multi-host DATABASE_URL; received '$DATABASE_URL'." >&2
    exit 2
  fi
  url_no_jdbc="${DATABASE_URL#jdbc:}"
  if [[ ! "$url_no_jdbc" =~ ^[a-zA-Z0-9]+://([^/@]+@)?(\[[^\]]+\]|[^/:]+)(:[0-9]+)?(/.*)?$ ]]; then
    echo "Malformed DATABASE_URL: '$DATABASE_URL'." >&2
    exit 2
  fi
  db_url_host="${BASH_REMATCH[2]}"
  verify_loopback_host "$db_url_host" "DATABASE_URL"
fi

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

verify_loopback_host "$PGHOST" "PGHOST"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for ephemeral PostgreSQL verification." >&2
  exit 2
fi

psql_cmd=(psql -X -A -t -v ON_ERROR_STOP=1)

case "$MODE" in
  preflight)
    table_count="$("${psql_cmd[@]}" -c "
      SELECT COUNT(*)
      FROM information_schema.tables
      WHERE table_schema = 'mypet';
    ")"
    if [[ ! "$table_count" =~ ^[0-9]+$ ]]; then
      echo "Unexpected ephemeral preflight response." >&2
      exit 1
    fi
    if (( table_count != 0 )); then
      echo "Ephemeral PostgreSQL is not empty before migration: mypet tables=$table_count." >&2
      exit 1
    fi
    echo "Ephemeral PostgreSQL preflight passed: fresh database, no mypet tables."
    ;;

  postflight)
    repo_latest=0
    migration_count=0
    for file in "$ROOT/backend/src/main/resources/db/migration"/V*__*.sql; do
      [[ -f "$file" ]] || continue
      migration_count=$((migration_count + 1))
      base="$(basename "$file")"
      if [[ "$base" =~ ^V([0-9]+)__ ]]; then
        version=$((10#${BASH_REMATCH[1]}))
        (( version > repo_latest )) && repo_latest="$version"
      fi
    done
    if (( migration_count == 0 || repo_latest == 0 )); then
      echo "No repository Flyway migrations found." >&2
      exit 1
    fi

    read -r live_latest failed_count < <(
      "${psql_cmd[@]}" -c "
        SELECT
          COALESCE(MAX(version::integer) FILTER (WHERE success AND version ~ '^[0-9]+$'), 0),
          COUNT(*) FILTER (WHERE NOT success)
        FROM mypet.flyway_schema_history;
      " | tr '|' ' '
    )

    if [[ ! "$live_latest" =~ ^[0-9]+$ || ! "$failed_count" =~ ^[0-9]+$ ]]; then
      echo "Unexpected Flyway history response from ephemeral PostgreSQL." >&2
      exit 1
    fi
    if (( failed_count != 0 || live_latest != repo_latest )); then
      echo "Ephemeral Flyway mismatch: repository V${repo_latest}, live V${live_latest}, failed=${failed_count}." >&2
      exit 1
    fi

    postgis_namespace="$("${psql_cmd[@]}" -c "
      SELECT COALESCE((
        SELECT n.nspname
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'postgis'
      ), 'missing');
    ")"
    if [[ "$postgis_namespace" != extensions ]]; then
      echo "PostGIS namespace mismatch: expected extensions, found '$postgis_namespace'." >&2
      exit 1
    fi

    non_empty_tables="$("${psql_cmd[@]}" -c "
      DO \$\$
      DECLARE
        r RECORD;
        cnt BIGINT;
        non_empty TEXT[] := ARRAY[]::TEXT[];
      BEGIN
        FOR r IN (
          SELECT table_name
          FROM information_schema.tables
          WHERE table_schema = 'mypet'
            AND table_type = 'BASE TABLE'
            AND table_name NOT IN ('flyway_schema_history', 'service_region', 'service_region_pincode')
          ORDER BY table_name
        ) LOOP
          EXECUTE format('SELECT count(*) FROM mypet.%I', r.table_name) INTO cnt;
          IF cnt > 0 THEN
            non_empty := array_append(non_empty, format('%s=%s', r.table_name, cnt));
          END IF;
        END LOOP;
        IF array_length(non_empty, 1) > 0 THEN
          RAISE EXCEPTION 'NON_EMPTY:%', array_to_string(non_empty, ',');
        END IF;
      END \$\$;
    " 2>&1)" || {
      if [[ "$non_empty_tables" =~ NON_EMPTY:([a-zA-Z0-9_,=]+) ]]; then
        echo "Ephemeral PostgreSQL unexpectedly contains transactional/seeded data: ${BASH_REMATCH[1]}." >&2
      else
        echo "Failed to verify ephemeral PostgreSQL data isolation: $non_empty_tables" >&2
      fi
      exit 1
    }

    echo "Ephemeral PostgreSQL certified: Flyway V${live_latest}; PostGIS=extensions; failed=0; all business tables verified empty."
    ;;

  *)
    echo "Usage: $0 <preflight|postflight>" >&2
    exit 2
    ;;
esac
