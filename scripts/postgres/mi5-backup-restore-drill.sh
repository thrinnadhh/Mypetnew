#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

case "${PGHOST#[}" in
  127.0.0.1|localhost|::1|::1]) ;;
  *) echo "MI5 recovery drill only permits loopback PostgreSQL." >&2; exit 2 ;;
esac

for command in psql sha256sum; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command is required." >&2; exit 2; }
done

SOURCE_DATABASE="$PGDATABASE"
RESTORE_DATABASE="${MI5_RESTORE_DATABASE:-mypet_restore}"
EVIDENCE_DIR="${MI5_EVIDENCE_DIR:-build/evidence/mi5-data-platform}"
PG_CLIENT_CONTAINER="${MI5_PG_CLIENT_CONTAINER:-}"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

DUMP_FILE="$EVIDENCE_DIR/mypet-recovery.dump"
LIST_FILE="$EVIDENCE_DIR/mypet-recovery.list"
CHECKSUM_FILE="$EVIDENCE_DIR/SHA256SUMS"
SUMMARY_FILE="$EVIDENCE_DIR/recovery-summary.txt"

query() {
  local database="$1"
  local sql="$2"
  PGDATABASE="$database" psql -X -A -t -v ON_ERROR_STOP=1 -c "$sql"
}

if [[ -n "$PG_CLIENT_CONTAINER" ]]; then
  command -v docker >/dev/null 2>&1 || { echo "docker is required for container-pinned PostgreSQL archive tools." >&2; exit 2; }
  docker inspect "$PG_CLIENT_CONTAINER" >/dev/null 2>&1 || { echo "MI5 PostgreSQL client container is unavailable." >&2; exit 2; }

  archive_dump() {
    docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CLIENT_CONTAINER" \
      pg_dump -h 127.0.0.1 -p 5432 -U "$PGUSER" -d "$SOURCE_DATABASE" \
      --format=custom --compress=9 --no-owner --no-privileges --schema=mypet > "$DUMP_FILE"
  }
  archive_list() {
    docker exec -i "$PG_CLIENT_CONTAINER" pg_restore --list < "$DUMP_FILE" > "$LIST_FILE"
  }
  database_drop() {
    docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CLIENT_CONTAINER" \
      dropdb -h 127.0.0.1 -p 5432 -U "$PGUSER" --if-exists "$RESTORE_DATABASE"
  }
  database_create() {
    docker exec -e PGPASSWORD="$PGPASSWORD" "$PG_CLIENT_CONTAINER" \
      createdb -h 127.0.0.1 -p 5432 -U "$PGUSER" "$RESTORE_DATABASE"
  }
  archive_restore() {
    docker exec -i -e PGPASSWORD="$PGPASSWORD" "$PG_CLIENT_CONTAINER" \
      pg_restore -h 127.0.0.1 -p 5432 -U "$PGUSER" \
      --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE" < "$DUMP_FILE"
  }
else
  for command in pg_dump pg_restore createdb dropdb; do
    command -v "$command" >/dev/null 2>&1 || { echo "$command is required when MI5_PG_CLIENT_CONTAINER is unset." >&2; exit 2; }
  done
  archive_dump() {
    pg_dump --format=custom --compress=9 --no-owner --no-privileges --schema=mypet --file="$DUMP_FILE"
  }
  archive_list() {
    pg_restore --list "$DUMP_FILE" > "$LIST_FILE"
  }
  database_drop() {
    dropdb --if-exists "$RESTORE_DATABASE"
  }
  database_create() {
    createdb "$RESTORE_DATABASE"
  }
  archive_restore() {
    PGDATABASE="$RESTORE_DATABASE" pg_restore \
      --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_DATABASE" "$DUMP_FILE"
  }
fi

source_latest="$(query "$SOURCE_DATABASE" "SELECT coalesce(max(version::int),0) FROM mypet.flyway_schema_history WHERE success=true AND version ~ '^[0-9]+$';")"
source_failed="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM mypet.flyway_schema_history WHERE success=false;")"
source_tables="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM information_schema.tables WHERE table_schema='mypet' AND table_type='BASE TABLE';")"
source_sequences="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM information_schema.sequences WHERE sequence_schema='mypet';")"
source_constraints="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='mypet';")"
source_indexes="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM pg_indexes WHERE schemaname='mypet';")"
source_history_rows="$(query "$SOURCE_DATABASE" "SELECT count(*) FROM mypet.flyway_schema_history;")"
source_history_checksum="$(query "$SOURCE_DATABASE" "SELECT md5(string_agg(coalesce(version,'') || ':' || coalesce(checksum::text,'') || ':' || success::text, '|' ORDER BY installed_rank)) FROM mypet.flyway_schema_history;")"

[[ "$source_failed" == "0" ]] || { echo "Source database has failed Flyway migrations." >&2; exit 1; }
[[ "$source_latest" =~ ^[0-9]+$ ]] || { echo "Source Flyway version is invalid." >&2; exit 1; }

backup_started="$(date +%s)"
archive_dump
archive_list
[[ -s "$DUMP_FILE" && -s "$LIST_FILE" ]] || { echo "Backup artifact verification failed." >&2; exit 1; }
(
  cd "$EVIDENCE_DIR"
  sha256sum "$(basename "$DUMP_FILE")" "$(basename "$LIST_FILE")" > "$(basename "$CHECKSUM_FILE")"
  sha256sum --check "$(basename "$CHECKSUM_FILE")"
)
backup_seconds="$(( $(date +%s) - backup_started ))"

database_drop
database_create
PGDATABASE="$RESTORE_DATABASE" bash ./scripts/postgres/prepare-supabase-postgis.sh

restore_started="$(date +%s)"
archive_restore
restore_seconds="$(( $(date +%s) - restore_started ))"

restore_latest="$(query "$RESTORE_DATABASE" "SELECT coalesce(max(version::int),0) FROM mypet.flyway_schema_history WHERE success=true AND version ~ '^[0-9]+$';")"
restore_failed="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM mypet.flyway_schema_history WHERE success=false;")"
restore_tables="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM information_schema.tables WHERE table_schema='mypet' AND table_type='BASE TABLE';")"
restore_sequences="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM information_schema.sequences WHERE sequence_schema='mypet';")"
restore_constraints="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM information_schema.table_constraints WHERE table_schema='mypet';")"
restore_indexes="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM pg_indexes WHERE schemaname='mypet';")"
restore_history_rows="$(query "$RESTORE_DATABASE" "SELECT count(*) FROM mypet.flyway_schema_history;")"
restore_history_checksum="$(query "$RESTORE_DATABASE" "SELECT md5(string_agg(coalesce(version,'') || ':' || coalesce(checksum::text,'') || ':' || success::text, '|' ORDER BY installed_rank)) FROM mypet.flyway_schema_history;")"
restore_postgis_schema="$(query "$RESTORE_DATABASE" "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='postgis';")"

[[ "$restore_failed" == "0" ]] || { echo "Restored database has failed Flyway migrations." >&2; exit 1; }
[[ "$restore_latest" == "$source_latest" ]] || { echo "Flyway version mismatch after restore." >&2; exit 1; }
[[ "$restore_tables" == "$source_tables" ]] || { echo "Table-count mismatch after restore." >&2; exit 1; }
[[ "$restore_sequences" == "$source_sequences" ]] || { echo "Sequence-count mismatch after restore." >&2; exit 1; }
[[ "$restore_constraints" == "$source_constraints" ]] || { echo "Constraint-count mismatch after restore." >&2; exit 1; }
[[ "$restore_indexes" == "$source_indexes" ]] || { echo "Index-count mismatch after restore." >&2; exit 1; }
[[ "$restore_history_rows" == "$source_history_rows" ]] || { echo "Flyway-history row-count mismatch after restore." >&2; exit 1; }
[[ "$restore_history_checksum" == "$source_history_checksum" ]] || { echo "Flyway-history checksum mismatch after restore." >&2; exit 1; }
[[ "$restore_postgis_schema" == "extensions" ]] || { echo "Restored PostGIS schema is not extensions." >&2; exit 1; }

dump_bytes="$(wc -c < "$DUMP_FILE" | tr -d ' ')"
dump_sha256="$(sha256sum "$DUMP_FILE" | awk '{print $1}')"
cat > "$SUMMARY_FILE" <<EOF
git_sha=${GITHUB_SHA:-local}
source_database=$SOURCE_DATABASE
restore_database=$RESTORE_DATABASE
source_flyway_latest=$source_latest
restore_flyway_latest=$restore_latest
source_flyway_failed=$source_failed
restore_flyway_failed=$restore_failed
source_tables=$source_tables
restore_tables=$restore_tables
source_sequences=$source_sequences
restore_sequences=$restore_sequences
source_constraints=$source_constraints
restore_constraints=$restore_constraints
source_indexes=$source_indexes
restore_indexes=$restore_indexes
flyway_history_rows=$restore_history_rows
postgis_schema=$restore_postgis_schema
dump_bytes=$dump_bytes
dump_sha256=$dump_sha256
backup_seconds_observed=$backup_seconds
restore_seconds_observed=$restore_seconds
archive_tooling=$([[ -n "$PG_CLIENT_CONTAINER" ]] && echo container-pinned || echo host)
production_rpo_certified=false
production_rto_certified=false
pitr_certified=false
production_cutover_certified=false
EOF
chmod 600 "$DUMP_FILE" "$LIST_FILE" "$CHECKSUM_FILE" "$SUMMARY_FILE"

echo "MI5 disposable backup/restore drill passed: source=$SOURCE_DATABASE restore=$RESTORE_DATABASE Flyway=$restore_latest"