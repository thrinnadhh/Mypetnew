#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS="$ROOT/backend/src/main/resources/db/migration"
FLYWAY_IMAGE="${FLYWAY_IMAGE:-flyway/flyway:12.4.0}"

: "${PREVIEW_PROJECT_REF:?PREVIEW_PROJECT_REF is required}"
: "${SUPABASE_PARENT_PROJECT_REF:?SUPABASE_PARENT_PROJECT_REF is required}"
: "${PREVIEW_JDBC_URL:?PREVIEW_JDBC_URL is required}"
: "${PREVIEW_DB_USER:?PREVIEW_DB_USER is required}"
: "${PREVIEW_DB_PASSWORD:?PREVIEW_DB_PASSWORD is required}"

if [[ "$PREVIEW_PROJECT_REF" == "$SUPABASE_PARENT_PROJECT_REF" ]]; then
  echo "Refusing to migrate the parent Supabase project from preview CI." >&2
  exit 2
fi
if [[ ! -d "$MIGRATIONS" ]]; then
  echo "Flyway migration directory is unavailable: $MIGRATIONS" >&2
  exit 2
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for preview Flyway migration." >&2
  exit 2
fi

run_flyway() {
  docker run --rm \
    -v "$MIGRATIONS:/flyway/sql:ro" \
    -e FLYWAY_URL="$PREVIEW_JDBC_URL" \
    -e FLYWAY_USER="$PREVIEW_DB_USER" \
    -e FLYWAY_PASSWORD="$PREVIEW_DB_PASSWORD" \
    "$FLYWAY_IMAGE" \
    -connectRetries=15 \
    -schemas=mypet \
    -defaultSchema=mypet \
    -createSchemas=true \
    -cleanDisabled=true \
    -validateMigrationNaming=true \
    "$@"
}

# Never baseline a non-empty schema here. Preview branches must prove that the
# repository's complete forward-only Flyway history can construct the database.
run_flyway migrate
run_flyway validate
run_flyway info

echo "Preview database migrated and validated with the repository Flyway chain."
