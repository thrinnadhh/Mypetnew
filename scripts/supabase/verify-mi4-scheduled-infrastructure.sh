#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "MI4 scheduled-infrastructure violation: $*" >&2
  exit 1
}

source_root="backend/src/main/kotlin"
lock_file="$source_root/in/mypetnew/common/scheduling/PostgresScheduledJobLock.kt"

[[ -f "$lock_file" ]] || fail "PostgresScheduledJobLock.kt is missing"
grep -Fq 'pg_catalog.pg_try_advisory_lock(?)' "$lock_file" || fail "non-blocking advisory lock acquisition is missing"
grep -Fq 'pg_catalog.pg_advisory_unlock(?)' "$lock_file" || fail "advisory lock release is missing"
if grep -Fq 'SELECT pg_catalog.pg_advisory_lock(?)' "$lock_file"; then
  fail "blocking advisory lock acquisition is not allowed"
fi

scheduled_count=$(grep -Rho --include='*.kt' '@Scheduled' "$source_root" | wc -l | tr -d ' ')
guarded_count=$(grep -Rho --include='*.kt' 'runIfAcquired(ScheduledJobNames\.[A-Z0-9_]*' "$source_root" | wc -l | tr -d ' ')

[[ "$scheduled_count" == "9" ]] || fail "expected 9 production @Scheduled entry points, found $scheduled_count"
[[ "$guarded_count" == "$scheduled_count" ]] || fail "expected every @Scheduled entry point to be advisory-lock guarded; scheduled=$scheduled_count guarded=$guarded_count"

expected_jobs=(
  DELIVERY_READY_RECOVERY
  DELIVERY_DISPATCH_RETRY
  PAYMENT_WEBHOOK_INBOX
  PAYMENT_RECONCILIATION
  PAYMENT_EXPIRY
  PAYMENT_REFUNDS
  RECURRING_ORDERS
  CATALOG_MEDIA_CLEANUP
  NOTIFICATION_DELIVERY
)

for job in "${expected_jobs[@]}"; do
  count=$(grep -Rho --include='*.kt' "runIfAcquired(ScheduledJobNames\.${job})" "$source_root" | wc -l | tr -d ' ')
  [[ "$count" == "1" ]] || fail "expected exactly one guarded scheduler use for $job, found $count"
done

bash ./scripts/supabase/verify-feature-boundaries.sh

echo "MI4 scheduled infrastructure repository contract passed: 9/9 schedulers are cluster-guarded."
