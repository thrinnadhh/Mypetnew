#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

scan_globs=(
  --hidden
  --glob '!.git/**'
  --glob '!node_modules/**'
  --glob '!**/build/**'
  --glob '!**/dist/**'
  --glob '!docs/**'
  --glob '!.env.example'
  --glob '!pnpm-lock.yaml'
)

secret_pattern='-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|FIREBASE_PRIVATE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|postgres(ql)?://[^[:space:]/:]+:[^${<[:space:]][^@[:space:]]+@'

if rg -n "${scan_globs[@]}" -- "$secret_pattern" .; then
  echo "Potential server credential or private key found." >&2
  exit 1
fi

client_pattern='SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS'
if rg -n -- "$client_pattern" apps packages; then
  echo "Privileged server configuration referenced by a client package." >&2
  exit 1
fi

echo "Secret-boundary scan passed."
