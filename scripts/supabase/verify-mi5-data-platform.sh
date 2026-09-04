#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "MI5 data-platform violation: $*" >&2
  exit 1
}

backup_script="scripts/supabase/export-free-tier-backup.sh"
drill_script="scripts/postgres/mi5-backup-restore-drill.sh"
storage_script="scripts/supabase/verify-storage-readonly.mjs"
workflow=".github/workflows/mi5-data-platform-certification.yml"
doc="docs/architecture/MI5_DATA_PLATFORM_CERTIFICATION.md"

for file in "$backup_script" "$drill_script" "$storage_script" "$workflow" "$doc"; do
  [[ -f "$file" ]] || fail "required file is missing: $file"
done

bash -n "$backup_script"
bash -n "$drill_script"

grep -Fq -- '--format=custom' "$backup_script" || fail "production backup is not custom-format"
grep -Fq 'pg_restore --list' "$backup_script" || fail "production backup list verification is missing"
grep -Eq 'shasum -a 256|sha256sum' "$backup_script" || fail "production backup checksum is missing"

grep -Fq -- '--format=custom' "$drill_script" || fail "recovery drill is not custom-format"
grep -Fq 'pg_restore --list' "$drill_script" || fail "recovery drill does not inspect archive contents"
grep -Fq -- '--exit-on-error' "$drill_script" || fail "recovery restore does not fail closed"
grep -Fq 'sha256sum --check' "$drill_script" || fail "recovery drill does not verify checksums"
grep -Fq 'MI5_PG_CLIENT_CONTAINER' "$drill_script" || fail "recovery drill lacks server-major archive-tool pinning"
grep -Fq 'archive_tooling=' "$drill_script" || fail "recovery evidence does not record archive tooling source"
grep -Fq 'production_rpo_certified=false' "$drill_script" || fail "RPO truth boundary is missing"
grep -Fq 'production_rto_certified=false' "$drill_script" || fail "RTO truth boundary is missing"
grep -Fq 'pitr_certified=false' "$drill_script" || fail "PITR truth boundary is missing"
grep -Fq 'production_cutover_certified=false' "$drill_script" || fail "cutover truth boundary is missing"

if grep -Eq "method:[[:space:]]*'(POST|PUT|PATCH|DELETE)'" "$storage_script"; then
  fail "read-only Storage verifier contains a mutating HTTP method"
fi
grep -Fq "method: 'GET'" "$storage_script" || fail "read-only Storage verifier does not use GET"
grep -Fq "id: 'catalog-media'" "$storage_script" || fail "catalog-media policy is missing"
grep -Fq "id: 'provider-verification-private'" "$storage_script" || fail "private verification bucket policy is missing"

grep -Fq 'Pin archive tools to PostgreSQL server major' "$workflow" || fail "workflow does not pin archive tools to the server major"
grep -Fq 'MI5_PG_CLIENT_CONTAINER=' "$workflow" || fail "workflow does not export pinned archive-tool container"
grep -Fq 'Boot restored backend' "$workflow" || fail "workflow does not boot the restored runtime"
grep -Fq 'mi5-backup-restore-drill.sh' "$workflow" || fail "workflow does not run recovery drill"
grep -Fq 'verify-storage-readonly.test.mjs' "$workflow" || fail "workflow does not test Storage verifier"
grep -Fq 'env -u SPRING_PROFILES_ACTIVE ./scripts/verify.sh' "$workflow" || fail "broad regression baseline must run without the recovery-only Spring profile"

grep -Fq 'does not certify production RPO' "$doc" || fail "documentation does not preserve RPO boundary"
grep -Fq 'does not certify production RTO' "$doc" || fail "documentation does not preserve RTO boundary"
grep -Fq 'does not certify PITR' "$doc" || fail "documentation does not preserve PITR boundary"

bash ./scripts/supabase/verify-feature-boundaries.sh

echo "MI5 data platform repository contract passed."
