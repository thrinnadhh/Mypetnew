#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

pass_count=0
fail_count=0

assert_fails() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "❌ ADVERSARIAL FAILURE: expected failure but succeeded: $desc" >&2
    fail_count=$((fail_count + 1))
  else
    echo "✅ PASS: $desc"
    pass_count=$((pass_count + 1))
  fi
}

assert_succeeds() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "✅ PASS: $desc"
    pass_count=$((pass_count + 1))
  else
    echo "❌ ADVERSARIAL FAILURE: expected success but failed: $desc" >&2
    fail_count=$((fail_count + 1))
  fi
}

echo "=== MI-1 ADVERSARIAL ISOLATION TEST SUITE ==="

# ---------------------------------------------------------------------------
# Test A1: Accidental staging / non-loopback database rejection
# ---------------------------------------------------------------------------
echo "--- Testing Non-Loopback Host Rejection (A1) ---"
assert_fails "Rejects Supabase staging hostname in PGHOST" \
  env PGHOST=db.gxxmbmcezyuqwywblzlh.supabase.co PGPORT=5432 PGUSER=test PGDATABASE=test \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects external IP in PGHOST" \
  env PGHOST=192.168.1.50 PGPORT=5432 PGUSER=test PGDATABASE=test \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects non-loopback DATABASE_URL even if PGHOST is 127.0.0.1" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://db.gxxmbmcezyuqwywblzlh.supabase.co:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects external IP in DATABASE_URL" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://10.0.0.99:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

# ---------------------------------------------------------------------------
# Test D3: Git tracking ignore for .mypet-env
# ---------------------------------------------------------------------------
echo "--- Testing Git Tracking Ignore (D3) ---"
assert_succeeds ".mypet-env directory is ignored by git" \
  git check-ignore -q .mypet-env/mi1-test/environment.sh

assert_succeeds ".mypet-env PID file is ignored by git" \
  git check-ignore -q .mypet-env/mi1-test/backend.pid

# ---------------------------------------------------------------------------
# Test C6: Competing migration history rejection
# ---------------------------------------------------------------------------
echo "--- Testing Architecture Boundary Guard (C6) ---"
mkdir -p supabase/migrations
rogue_migration="supabase/migrations/V999__competing_rogue_migration.sql"
touch "$rogue_migration"

assert_fails "Feature boundary verifier rejects SQL in supabase/migrations" \
  bash ./scripts/supabase/verify-feature-boundaries.sh

rm -f "$rogue_migration"
rmdir supabase/migrations 2>/dev/null || true

assert_succeeds "Feature boundary verifier passes when supabase/migrations is absent" \
  bash ./scripts/supabase/verify-feature-boundaries.sh

# ---------------------------------------------------------------------------
# Test C4: Deferred extension rejection in application Flyway migrations
# ---------------------------------------------------------------------------
echo "--- Testing Deferred Extension Rejection (C4) ---"
rogue_ext_migration="backend/src/main/resources/db/migration/V999__rogue_pgmq.sql"
cat >"$rogue_ext_migration" <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgmq;
SQL

assert_fails "Feature boundary verifier rejects pgmq in application migrations" \
  bash ./scripts/supabase/verify-feature-boundaries.sh

rm -f "$rogue_ext_migration"

# ---------------------------------------------------------------------------
# Test F9: Stale PID safety and process identity verification
# ---------------------------------------------------------------------------
echo "--- Testing Stale PID Safety (F9) ---"
test_env_dir=".mypet-env/adversarial-pid-test"
mkdir -p "$test_env_dir"
test_pid_file="$test_env_dir/backend.pid"

# Scenario 1: PID points to a process that does not exist (e.g. 999999)
echo "999999" >"$test_pid_file"
# Call stop_backend logic via isolated-postgres-env.sh stop (mocked state)
cat >"$test_env_dir/environment.sh" <<'EOF'
CONTAINER=nonexistent-container
NETWORK=nonexistent-net
EOF
assert_succeeds "Stop cleans up non-existent PID file without failure" \
  bash -c "
    bash ./scripts/dev/isolated-postgres-env.sh stop adversarial-pid-test >/dev/null 2>&1 || true
    [[ ! -f '$test_pid_file' ]]
  "

# Scenario 2: PID points to an active unrelated user process (e.g. sleep)
sleep 60 &
unrelated_pid=$!
echo "$unrelated_pid" >"$test_pid_file"
assert_succeeds "Stop does NOT kill unrelated process and removes stale PID file" \
  bash -c "
    bash ./scripts/dev/isolated-postgres-env.sh stop adversarial-pid-test >/dev/null 2>&1 || true
    kill -0 '$unrelated_pid' 2>/dev/null && [[ ! -f '$test_pid_file' ]]
  "
kill "$unrelated_pid" 2>/dev/null || true
rm -rf "$test_env_dir"

# ---------------------------------------------------------------------------
# Test F1: Duplicate environment refusal
# ---------------------------------------------------------------------------
echo "--- Testing Duplicate Environment Refusal (F1) ---"
dup_dir=".mypet-env/adversarial-dup-test"
mkdir -p "$dup_dir"
touch "$dup_dir/environment.sh"
assert_fails "Create refuses when environment already exists" \
  bash ./scripts/dev/isolated-postgres-env.sh create adversarial-dup-test
rm -rf "$dup_dir"

# ---------------------------------------------------------------------------
# Test Summary
# ---------------------------------------------------------------------------
echo "=== Adversarial Test Summary: $pass_count passed, $fail_count failed ==="
if (( fail_count > 0 )); then
  exit 1
fi
echo "All adversarial tests certified successfully."
