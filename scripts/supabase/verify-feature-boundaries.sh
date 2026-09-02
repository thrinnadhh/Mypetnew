#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "Supabase feature-boundary violation: $*" >&2
  exit 1
}

app_source_files() {
  find apps \
    \( -type d \( -name node_modules -o -name dist -o -name .expo -o -name coverage \) -prune \) -o \
    \( -type f \( \
      -name 'package.json' -o \
      -name '*.js' -o -name '*.jsx' -o \
      -name '*.mjs' -o -name '*.cjs' -o \
      -name '*.ts' -o -name '*.tsx' \
    \) -print \)
}

# Client applications must remain API clients of Spring Boot. Scan executable
# app source plus direct package manifests, but intentionally ignore lockfiles:
# a transitive dependency may contain Supabase without the app importing it.
if app_source_files | xargs -r grep -Il -F '@supabase/supabase-js' | grep -q .; then
  echo "Files referencing @supabase/supabase-js:" >&2
  app_source_files | xargs -r grep -Il -F '@supabase/supabase-js' >&2 || true
  fail "client application references @supabase/supabase-js"
fi

# Never place privileged Supabase/database credentials in executable app source
# or direct package manifests. The backend/deployment environment is the only
# permitted holder.
if app_source_files | xargs -r grep -InE \
  'SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_PASSWORD|SPRING_DATASOURCE_PASSWORD'; then
  fail "privileged database/Supabase credential name appears in application source"
fi

# Direct PostgREST/Realtime access from mobile/web clients is intentionally
# deferred. Clients use Spring Boot APIs; live UX may later use an explicitly
# reviewed event projection.
if app_source_files | xargs -r grep -InE \
  'supabase\.co/(rest|realtime)/v1|/rest/v1/|/realtime/v1/'; then
  fail "direct Supabase Data API/Realtime endpoint appears in application source"
fi

# Spring Boot/Flyway owns schema evolution. Preview branching may use
# supabase/config.toml for environment configuration, but SQL migration copies
# under supabase/migrations would create a second migration authority.
if [[ -d supabase/migrations ]]; then
  if find supabase/migrations -type f -name '*.sql' -print -quit | grep -q .; then
    fail "supabase/migrations contains SQL; backend Flyway must remain the sole migration authority"
  fi
fi

# Edge Functions are not an application-domain runtime in MyPetNew. If this
# directory is introduced later, the architecture decision must be explicit.
if [[ -d supabase/functions ]]; then
  if find supabase/functions -type f -not -name '.gitkeep' -print -quit | grep -q .; then
    fail "Supabase Edge Function code exists; domain logic must remain in Spring Boot"
  fi
fi

# PGMQ, pg_cron and pgvector are deliberate deferrals. PostGIS is NOT blocked by
# this guard because Phase 8 may intentionally enable it in a future V31+ change.
if grep -RIn --include='V*__*.sql' \
  -E 'create[[:space:]]+extension([[:space:]]+if[[:space:]]+not[[:space:]]+exists)?[[:space:]]+(pgmq|pg_cron|vector)([[:space:];]|$)' \
  backend/src/main/resources/db/migration 2>/dev/null; then
  fail "deferred Supabase/Postgres extension enabled in application Flyway migrations"
fi

echo "Supabase feature boundaries verified: Spring/Flyway authority preserved; deferred features remain deferred."
