#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

secret_pattern='-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|FIREBASE_PRIVATE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|postgres(ql)?://[^[:space:]/:]+:[^${<[:space:]][^@[:space:]]+@'

if command -v rg >/dev/null 2>&1; then
  scan_globs=(
    --hidden
    --glob '!.git/**'
    --glob '!**/build/**'
    --glob '!docs/**'
    --glob '!.env.example'
  )

  if rg -n "${scan_globs[@]}" -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi
else
  echo "ripgrep not available; using grep fallback for secret-boundary scan."
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=build \
    --exclude-dir=docs \
    --exclude='.env.example' \
    -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi
fi

echo "Secret-boundary scan passed."
