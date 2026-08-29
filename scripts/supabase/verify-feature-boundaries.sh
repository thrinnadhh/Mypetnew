#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "Supabase feature-boundary violation: $*" >&2
  exit 1
}

# Client applications must remain API clients of Spring Boot. Introducing the
# Supabase JS client would create a second auth/data-access surface and requires
# an explicit architecture change to this guard.
if grep -RIl --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.expo \
  -F '@supabase/supabase-js' apps 2>/dev/null | grep -q .; then
  fail "client application references @supabase/supabase-js"
fi

# Never place privileged Supabase/database credentials in app source or app env
# templates. The backend/deployment environment is the only permitted holder.
if grep -RIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.expo \
  -E 'SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|DATABASE_PASSWORD|SPRING_DATASOURCE_PASSWORD' \
  apps 2>/dev/null; then
  fail "privileged database/Supabase credential name appears under apps/"
fi

# Direct PostgREST/Realtime access from mobile/web clients is intentionally
# deferred. Clients use Spring Boot APIs; live UX may later use an explicitly
# reviewed event projection.
if grep -RIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.expo \
  -E 'supabase\.co/(rest|realtime)/v1|/rest/v1/|/realtime/v1/' \
  apps 2>/dev/null; then
  fail "direct Supabase Data API/Realtime endpoint appears under apps/"
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

echo "Supabase feature boundaries verified: Spring authority preserved; deferred features remain deferred."
