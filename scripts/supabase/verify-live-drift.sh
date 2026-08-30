#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="${SUPABASE_DATABASE_URL:-}"

if [[ -z "$DB_URL" ]]; then
  echo "SUPABASE_DATABASE_URL is required for live drift verification." >&2
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for live drift verification." >&2
  exit 2
fi

mapfile -t migration_files < <(find "$ROOT/backend/src/main/resources/db/migration" -maxdepth 1 -type f -name 'V*__*.sql' -print | sort -V)
if (( ${#migration_files[@]} == 0 )); then
  echo "No repository migrations found." >&2
  exit 1
fi

repo_latest=0
for file in "${migration_files[@]}"; do
  base="$(basename "$file")"
  if [[ "$base" =~ ^V([0-9]+)__ ]]; then
    version=$((10#${BASH_REMATCH[1]}))
    if (( version > repo_latest )); then
      repo_latest="$version"
    fi
  fi
done

read -r live_latest failed_count < <(
  psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
    SELECT
      COALESCE(MAX(version::integer) FILTER (WHERE success AND version ~ '^[0-9]+$'), 0),
      COUNT(*) FILTER (WHERE NOT success)
    FROM mypet.flyway_schema_history;
  " | tr '|' ' '
)

if [[ ! "$live_latest" =~ ^[0-9]+$ || ! "$failed_count" =~ ^[0-9]+$ ]]; then
  echo "Unexpected Flyway history response from live database." >&2
  exit 1
fi

if (( failed_count != 0 )); then
  echo "Live database contains ${failed_count} failed Flyway migration(s)." >&2
  exit 1
fi

if (( live_latest != repo_latest )); then
  echo "Flyway drift detected: repository V${repo_latest}, live database V${live_latest}." >&2
  exit 1
fi

echo "Live Flyway state matches repository: V${repo_latest}; failed migrations: 0."
