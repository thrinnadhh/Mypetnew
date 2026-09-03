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

assert_fails "Rejects multi-host failover DATABASE_URL with comma injection" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://127.0.0.1:5432,evil.com:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects malicious subdomain suffix in DATABASE_URL host" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://localhost.evil.com:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects 0.0.0.0 wildcard host in DATABASE_URL" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://0.0.0.0:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

assert_fails "Rejects host.docker.internal in DATABASE_URL" \
  env PGHOST=127.0.0.1 PGPORT=5432 PGUSER=test PGDATABASE=test \
  DATABASE_URL="jdbc:postgresql://host.docker.internal:5432/mypet" \
  bash ./scripts/postgres/verify-ephemeral-db.sh preflight

# ---------------------------------------------------------------------------
# Test A2: Valid loopback representations (IPv4, localhost, IPv6)
# ---------------------------------------------------------------------------
echo "--- Testing Valid Loopback Representations (A2) ---"
# Test host verification parser directly (without psql execution by using invalid port after validation)
assert_succeeds "Valid IPv4 loopback passes host check (fails at connection stage, not host stage)" \
  bash -c '
    out=$(DATABASE_URL="jdbc:postgresql://127.0.0.1:1/mypet" PGHOST=127.0.0.1 PGPORT=1 PGUSER=u PGDATABASE=d bash ./scripts/postgres/verify-ephemeral-db.sh preflight 2>&1 || true)
    [[ "$out" != *"only permits loopback"* ]]
  '

assert_succeeds "Valid localhost loopback passes host check" \
  bash -c '
    out=$(DATABASE_URL="jdbc:postgresql://localhost:1/mypet" PGHOST=localhost PGPORT=1 PGUSER=u PGDATABASE=d bash ./scripts/postgres/verify-ephemeral-db.sh preflight 2>&1 || true)
    [[ "$out" != *"only permits loopback"* ]]
  '

assert_succeeds "Valid IPv6 [::1] loopback passes host check" \
  bash -c '
    out=$(DATABASE_URL="jdbc:postgresql://[::1]:1/mypet" PGHOST="::1" PGPORT=1 PGUSER=u PGDATABASE=d bash ./scripts/postgres/verify-ephemeral-db.sh preflight 2>&1 || true)
    [[ "$out" != *"only permits loopback"* ]]
  '

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
chmod 700 "$test_env_dir"
test_pid_file="$test_env_dir/backend.pid"

# Scenario 1: PID points to a process that does not exist (e.g. 999999)
echo "999999" >"$test_pid_file"
chmod 600 "$test_pid_file"
cat >"$test_env_dir/environment.sh" <<'EOF'
CONTAINER='nonexistent-container'
NETWORK='nonexistent-net'
EOF
chmod 600 "$test_env_dir/environment.sh"
assert_succeeds "Stop cleans up non-existent PID file without failure" \
  bash -c "
    bash ./scripts/dev/isolated-postgres-env.sh stop adversarial-pid-test >/dev/null 2>&1 || true
    [[ ! -f '$test_pid_file' ]]
  "

# Scenario 2: PID points to an active unrelated user process (e.g. sleep)
sleep 60 &
unrelated_pid=$!
echo "$unrelated_pid" >"$test_pid_file"
chmod 600 "$test_pid_file"
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
chmod 700 "$dup_dir"
touch "$dup_dir/environment.sh"
chmod 600 "$dup_dir/environment.sh"
assert_fails "Create refuses when environment already exists" \
  bash ./scripts/dev/isolated-postgres-env.sh create adversarial-dup-test
rm -rf "$dup_dir"

# ---------------------------------------------------------------------------
# Test S1: Symlinked state directory and state file rejection
# ---------------------------------------------------------------------------
echo "--- Testing Symlink Path Rejection (S1) ---"
sym_target_dir=".mypet-env/symlink-target-$$"
sym_link_dir=".mypet-env/adversarial-sym-dir"
mkdir -p "$sym_target_dir"
chmod 700 "$sym_target_dir"
ln -s "symlink-target-$$" "$sym_link_dir"

assert_fails "Refuses operation when state directory is a symlink" \
  bash ./scripts/dev/isolated-postgres-env.sh status adversarial-sym-dir

rm -f "$sym_link_dir"
rm -rf "$sym_target_dir"

sym_file_dir=".mypet-env/adversarial-sym-file"
mkdir -p "$sym_file_dir"
chmod 700 "$sym_file_dir"
ln -s "/etc/passwd" "$sym_file_dir/environment.sh"

assert_fails "Refuses operation when environment.sh is a symlink" \
  bash ./scripts/dev/isolated-postgres-env.sh status adversarial-sym-file

rm -rf "$sym_file_dir"

# ---------------------------------------------------------------------------
# Test S2: Unsafe permissions and command injection in state file
# ---------------------------------------------------------------------------
echo "--- Testing State File Security Guards (S2) ---"
perm_dir=".mypet-env/adversarial-perm-test"
mkdir -p "$perm_dir"
chmod 700 "$perm_dir"
cat >"$perm_dir/environment.sh" <<'EOF'
CONTAINER='c'
NETWORK='n'
EOF
chmod 666 "$perm_dir/environment.sh" # World-writable

assert_fails "Refuses to source state file with unsafe world-writable permissions" \
  bash ./scripts/dev/isolated-postgres-env.sh status adversarial-perm-test

# Malicious command injection in state file
chmod 600 "$perm_dir/environment.sh"
cat >>"$perm_dir/environment.sh" <<'EOF'
INJECTED=$(touch /tmp/malicious_execution_marker)
EOF

assert_fails "Refuses to source state file with command substitution syntax" \
  bash ./scripts/dev/isolated-postgres-env.sh status adversarial-perm-test

rm -rf "$perm_dir"

# ---------------------------------------------------------------------------
# Test E1: Malicious environment name validation
# ---------------------------------------------------------------------------
echo "--- Testing Malicious Environment Name Rejection (E1) ---"
assert_fails "Rejects path traversal ../evil in environment name" \
  bash ./scripts/dev/isolated-postgres-env.sh create "../evil"

assert_fails "Rejects slash in environment name" \
  bash ./scripts/dev/isolated-postgres-env.sh create "foo/bar"

assert_fails "Rejects uppercase letters in environment name" \
  bash ./scripts/dev/isolated-postgres-env.sh create "EnvName"

assert_fails "Rejects command substitution in environment name" \
  bash ./scripts/dev/isolated-postgres-env.sh create '$(whoami)'

assert_fails "Rejects leading hyphen in environment name" \
  bash ./scripts/dev/isolated-postgres-env.sh create "--help"

assert_fails "Rejects environment name exceeding 31 characters" \
  bash ./scripts/dev/isolated-postgres-env.sh create "a-very-long-name-that-exceeds-maximum-length"

# ---------------------------------------------------------------------------
# Test Summary
# ---------------------------------------------------------------------------
echo "=== Adversarial Test Summary: $pass_count passed, $fail_count failed ==="
if (( fail_count > 0 )); then
  exit 1
fi
echo "All adversarial tests certified successfully."
