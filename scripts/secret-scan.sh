#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

secret_pattern='-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|FIREBASE_PRIVATE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|postgres(ql)?://[^[:space:]/:]+:[^${<[:space:]][^@[:space:]]+@'
client_pattern='SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS'

if command -v rg >/dev/null 2>&1; then
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

  if rg -n "${scan_globs[@]}" -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi

  if rg -n -- "$client_pattern" apps packages; then
    echo "Privileged server configuration referenced by a client package." >&2
    exit 1
  fi
else
  echo "ripgrep not available; using grep fallback for secret-boundary scan."
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=build \
    --exclude-dir=dist \
    --exclude-dir=docs \
    --exclude='.env.example' \
    --exclude='pnpm-lock.yaml' \
    -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi

  if grep -RInE -- "$client_pattern" apps packages; then
    echo "Privileged server configuration referenced by a client package." >&2
    exit 1
  fi
fi

echo "Secret-boundary scan passed."
