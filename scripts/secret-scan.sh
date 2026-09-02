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
    --glob '!mypet-work/**'
    --glob '!docs/**'
    --glob '!.env.example'
    --glob '!.env.staging.example'
    --glob '!package-lock.json'
  )

  scan_status=0
  rg -q "${scan_globs[@]}" -- "$secret_pattern" . || scan_status=$?
  case "$scan_status" in
    0) echo "Potential server credential or private key found." >&2; exit 1 ;;
    1) ;;
    *) echo "Secret-boundary scanner failed before completing." >&2; exit 1 ;;
  esac
else
  echo "ripgrep not available; using grep fallback for secret-boundary scan."
  scan_status=0
  grep -RqE \
    --exclude-dir=.git \
    --exclude-dir=node_modules \
    --exclude-dir=build \
    --exclude-dir=dist \
    --exclude-dir=dist-ci \
    --exclude-dir=.expo \
    --exclude-dir=.pnpm-store \
    --exclude-dir=mypet-work \
    --exclude-dir=docs \
    --exclude='.env.example' \
    --exclude='.env.staging.example' \
    --exclude='package-lock.json' \
    -- "$secret_pattern" . || scan_status=$?
  case "$scan_status" in
    0) echo "Potential server credential or private key found." >&2; exit 1 ;;
    1) ;;
    *) echo "Secret-boundary scanner failed before completing." >&2; exit 1 ;;
  esac
fi

# Tracked environment templates are intentionally excluded from the broad secret
# regex above. Fail closed if any privileged template assignment stops using the
# repository's explicit replace-* placeholder convention.
template_secret_keys='^(DATABASE_PASSWORD|MYPET_TOKEN_SECRET|MYPET_DEVICE_TOKEN_KEY|SUPABASE_SERVICE_ROLE_KEY|CASHFREE_CLIENT_SECRET)='
for template in .env.example .env.staging.example; do
  [[ -f "$template" ]] || continue
  template_assignments=""
  scan_status=0
  template_assignments="$(grep -E "$template_secret_keys" "$template")" || scan_status=$?
  case "$scan_status" in
    0)
      while IFS= read -r assignment; do
        value="${assignment#*=}"
        if [[ "$value" != replace-* ]]; then
          echo "$template contains a non-placeholder privileged value for ${assignment%%=*}." >&2
          exit 1
        fi
      done <<< "$template_assignments"
      ;;
    1) ;;
    *) echo "Environment template scanner failed before completing." >&2; exit 1 ;;
  esac
done

client_pattern='SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS'
if command -v rg >/dev/null 2>&1; then
  scan_status=0
  rg -q --glob '!**/node_modules/**' --glob '!**/dist/**' --glob '!**/dist-ci/**' -- "$client_pattern" apps || scan_status=$?
  case "$scan_status" in
    0) echo "Privileged server configuration referenced by a client package." >&2; exit 1 ;;
    1) ;;
    *) echo "Client privilege scanner failed before completing." >&2; exit 1 ;;
  esac
else
  scan_status=0
  grep -RqE \
    --exclude-dir=node_modules \
    --exclude-dir=dist \
    --exclude-dir=dist-ci \
    -- "$client_pattern" apps || scan_status=$?
  case "$scan_status" in
    0) echo "Privileged server configuration referenced by a client package." >&2; exit 1 ;;
    1) ;;
    *) echo "Client privilege scanner failed before completing." >&2; exit 1 ;;
  esac
fi

echo "Secret-boundary scan passed."
