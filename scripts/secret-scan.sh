#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

secret_pattern='-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----|"type"[[:space:]]*:[[:space:]]*"service_account"|SUPABASE_SERVICE_ROLE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|FIREBASE_PRIVATE_KEY[[:space:]]*=[[:space:]]*[^$<{[:space:]][^[:space:]]{15,}|postgres(ql)?://[^[:space:]/:]+:[^${<[:space:]][^@[:space:]]+@'

if command -v rg >/dev/null 2>&1; then
  scan_globs=(
    --hidden
    --glob '!.git/**'
    --glob '!**/node_modules/**'
    --glob '!**/build/**'
    --glob '!**/dist/**'
    --glob '!**/dist-ci/**'
    --glob '!**/.expo/**'
    --glob '!.pnpm-store/**'
    --glob '!docs/**'
    --glob '!.env.example'
    --glob '!.env.staging.example'
    --glob '!package-lock.json'
  )

  if rg -n "${scan_globs[@]}" -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi
else
  echo "ripgrep not available; using grep fallback for secret-boundary scan."
  if grep -RInE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=build \
    --exclude-dir=dist \
    --exclude-dir=dist-ci \
    --exclude-dir=.expo \
    --exclude-dir=.pnpm-store \
    --exclude-dir=docs \
    --exclude='.env.example' \
    --exclude='.env.staging.example' \
    --exclude='package-lock.json' \
    -- "$secret_pattern" .; then
    echo "Potential server credential or private key found." >&2
    exit 1
  fi
fi

# Tracked environment templates are intentionally excluded from the broad secret
# regex above. Fail closed if any privileged template assignment stops using the
# repository's explicit replace-* placeholder convention.
template_secret_keys='^(DATABASE_PASSWORD|MYPET_TOKEN_SECRET|MYPET_DEVICE_TOKEN_KEY|SUPABASE_SERVICE_ROLE_KEY|CASHFREE_CLIENT_SECRET)='
for template in .env.example .env.staging.example; do
  [[ -f "$template" ]] || continue
  while IFS= read -r assignment; do
    value="${assignment#*=}"
    if [[ "$value" != replace-* ]]; then
      echo "$template contains a non-placeholder privileged value for ${assignment%%=*}." >&2
      exit 1
    fi
  done < <(grep -E "$template_secret_keys" "$template" || true)
done

client_pattern='SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS'
if rg -n --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/dist-ci/**' -- "$client_pattern" apps; then
  echo "Privileged server configuration referenced by a client package." >&2
  exit 1
fi

echo "Secret-boundary scan passed."
