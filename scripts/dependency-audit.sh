#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

exception_expiry="2026-09-11"
audit_date="${MYPET_AUDIT_DATE_OVERRIDE:-$(date -u +%F)}"
if [[ "$audit_date" > "$exception_expiry" ]]; then
  echo "The Expo image-size security exceptions expired on $exception_expiry." >&2
  exit 1
fi

corepack pnpm audit --prod --audit-level high
