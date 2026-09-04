#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bash ./scripts/supabase/verify-repository-migrations.sh
bash ./scripts/supabase/verify-feature-boundaries.sh

migration="backend/src/main/resources/db/migration/V32__async_delivery_state_hardening.sql"
worker="backend/src/main/kotlin/in/mypetnew/engagement/infrastructure/JdbcNotificationDelivery.kt"
inventory="backend/src/main/kotlin/in/mypetnew/catalog/infrastructure/JdbcInventoryPersistence.kt"
[[ -f "$migration" && -f "$worker" && -f "$inventory" ]] || {
  echo "MI3: required async implementation files are missing" >&2
  exit 1
}

for pattern in \
  "chk_outbox_event_status" \
  "chk_notification_attempt_status" \
  "NOT VALID" \
  "VALIDATE CONSTRAINT"; do
  grep -Fq "$pattern" "$migration" || {
    echo "MI3: V32 missing lifecycle hardening: $pattern" >&2
    exit 1
  }
done

# Existing queue semantics must remain real, transactional and concurrency-safe.
grep -Fq "FOR UPDATE OF a SKIP LOCKED" "$worker" || {
  echo "MI3: notification claims no longer use SKIP LOCKED" >&2
  exit 1
}
grep -Fq "status = 'RETRY'" "$worker" || {
  echo "MI3: retry state handling is missing" >&2
  exit 1
}
grep -Fq "status = 'DEAD_LETTER'" "$worker" || {
  echo "MI3: dead-letter state handling is missing" >&2
  exit 1
}
grep -Fq "INSERT INTO mypet.dead_letter" "$worker" || {
  echo "MI3: durable dead-letter persistence is missing" >&2
  exit 1
}
grep -Fq "INSERT INTO mypet.outbox_event" "$inventory" || {
  echo "MI3: transactional inventory publication is missing" >&2
  exit 1
}

# PGMQ must not be introduced in parallel while the Spring outbox/inbox owns async delivery.
if grep -RIn --exclude='verify-mi3-async-infrastructure.sh' --exclude='MI3_ASYNC_INFRASTRUCTURE.md' \
  -E '\b(pg_mq|pgmq|queue_send|queue_read)\b' backend/src/main scripts infra .github 2>/dev/null; then
  echo "MI3: competing PGMQ queue authority detected" >&2
  exit 1
fi

# inbox_event's composite primary key is the durable consumer dedupe contract.
grep -Fq "PRIMARY KEY (consumer_name, source_event_id)" \
  backend/src/main/resources/db/migration/V1__sprint_1_private_schema.sql || {
  echo "MI3: inbox consumer dedupe key is missing" >&2
  exit 1
}

echo "MI3 async infrastructure repository contract passed."
