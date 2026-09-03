#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bash ./scripts/supabase/verify-repository-migrations.sh
bash ./scripts/supabase/verify-feature-boundaries.sh

v31="backend/src/main/resources/db/migration/V31__supabase_security_postgis_foundation.sql"
[[ -f "$v31" ]] || { echo "MI2: V31 foundation migration is missing" >&2; exit 1; }

required_v31_patterns=(
  "CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions"
  "idx_provider_outlet_dispatch_geog"
  "idx_service_region_center_geog"
  "chk_provider_dispatch_coordinates"
  "chk_service_region_center_coordinates"
  "SET search_path = pg_catalog"
)
for pattern in "${required_v31_patterns[@]}"; do
  grep -Fq "$pattern" "$v31" || {
    echo "MI2: V31 is missing required core-data invariant: $pattern" >&2
    exit 1
  }
done

runtime_sql="infra/supabase/verify_runtime_role.sql"
live_sql="infra/supabase/mi2_core_data_contract.sql"
[[ -f "$runtime_sql" && -f "$live_sql" ]] || {
  echo "MI2: runtime/live database certification SQL is missing" >&2
  exit 1
}

grep -Fq "DATABASE_USERNAME=mypet_runtime" .env.staging.example || {
  echo "MI2: staging runtime identity is not mypet_runtime" >&2
  exit 1
}
grep -Fq "SPRING_FLYWAY_USER=replace-with-migration-user" .env.staging.example || {
  echo "MI2: migration identity separation is missing" >&2
  exit 1
}

# Domain clients must remain API clients, not direct Supabase Data API writers.
if grep -RIn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  -E '\bsupabase\s*\.\s*(from|rpc)\s*\(' apps/customer-app/src apps/merchant-app/src 2>/dev/null; then
  echo "MI2: direct Supabase domain-table access found in role client source" >&2
  exit 1
fi

# The live contract is intentionally assertion-only. Disallow obvious data/schema mutations.
if grep -Ein '^[[:space:]]*(insert|update|delete|merge|create[[:space:]]+(table|role|schema|extension)|alter|drop|truncate|grant|revoke)[[:space:]]' "$live_sql"; then
  echo "MI2: live certification SQL contains a mutating statement" >&2
  exit 1
fi

if [[ -n "${MI2_DATABASE_URL:-}" ]]; then
  command -v psql >/dev/null 2>&1 || { echo "MI2: psql required for live certification" >&2; exit 2; }
  psql "$MI2_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$live_sql"
else
  echo "MI2: live DB URL not supplied; repository and disposable-Postgres CI remain authoritative for PRs."
fi

echo "MI2 core data architecture repository contract passed."
