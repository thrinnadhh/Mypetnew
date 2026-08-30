#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "SUPABASE_DATABASE_URL is required." >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump is required (PostgreSQL client tools)." >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "pg_restore is required (PostgreSQL client tools)." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required (PostgreSQL client tools)." >&2
  exit 1
fi

BACKUP_ROOT="${BACKUP_ROOT:-${HOME}/mypetnew-backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

MYPET_DUMP_FILE="${BACKUP_DIR}/petshop-staging-mypet.dump"
LEGACY_DUMP_FILE="${BACKUP_DIR}/petshop-staging-legacy-captain.dump"
META_FILE="${BACKUP_DIR}/baseline.txt"
CHECKSUM_FILE="${BACKUP_DIR}/SHA256SUMS"
MYPET_LIST_FILE="${BACKUP_DIR}/restore-list-mypet.txt"
LEGACY_LIST_FILE="${BACKUP_DIR}/restore-list-legacy-captain.txt"

umask 077

psql "${SUPABASE_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -Atc "
select 'captured_at_utc=' || now() at time zone 'utc';
select 'database=' || current_database();
select 'server_version=' || current_setting('server_version');
select 'flyway_latest=' || coalesce(max(version::int),0)
from mypet.flyway_schema_history
where success=true and version ~ '^[0-9]+$';
select 'flyway_failed=' || count(*) from mypet.flyway_schema_history where success=false;
select 'mypet_tables=' || count(*)
from information_schema.tables
where table_schema='mypet' and table_type='BASE TABLE';
select 'captain_locations_rows=' || count(*) from public.captain_locations;
select 'captain_onboarding_rows=' || count(*) from public.captain_onboarding;
select 'captain_support_tickets_rows=' || count(*) from public.captain_support_tickets;
" > "${META_FILE}"

pg_dump "${SUPABASE_DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --schema=mypet \
  --file="${MYPET_DUMP_FILE}"

pg_dump "${SUPABASE_DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --table=public.captain_locations \
  --table=public.captain_onboarding \
  --table=public.captain_support_tickets \
  --file="${LEGACY_DUMP_FILE}"

pg_restore --list "${MYPET_DUMP_FILE}" > "${MYPET_LIST_FILE}"
pg_restore --list "${LEGACY_DUMP_FILE}" > "${LEGACY_LIST_FILE}"

for file in "${MYPET_DUMP_FILE}" "${LEGACY_DUMP_FILE}" "${MYPET_LIST_FILE}" "${LEGACY_LIST_FILE}"; do
  if [[ ! -s "${file}" ]]; then
    echo "Backup verification failed: ${file} is empty." >&2
    exit 1
  fi
done

CHECKSUM_TARGETS=(
  "$(basename "${MYPET_DUMP_FILE}")"
  "$(basename "${LEGACY_DUMP_FILE}")"
  "$(basename "${META_FILE}")"
  "$(basename "${MYPET_LIST_FILE}")"
  "$(basename "${LEGACY_LIST_FILE}")"
)

if command -v shasum >/dev/null 2>&1; then
  (cd "${BACKUP_DIR}" && shasum -a 256 "${CHECKSUM_TARGETS[@]}" > "$(basename "${CHECKSUM_FILE}")")
elif command -v sha256sum >/dev/null 2>&1; then
  (cd "${BACKUP_DIR}" && sha256sum "${CHECKSUM_TARGETS[@]}" > "$(basename "${CHECKSUM_FILE}")")
else
  echo "Neither shasum nor sha256sum is available." >&2
  exit 1
fi

chmod 600 "${MYPET_DUMP_FILE}" "${LEGACY_DUMP_FILE}" "${META_FILE}" "${MYPET_LIST_FILE}" "${LEGACY_LIST_FILE}" "${CHECKSUM_FILE}"

echo "Verified staging backup created at: ${BACKUP_DIR}"
echo "Keep this directory outside the repository and do not commit it."
