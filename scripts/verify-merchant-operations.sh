#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

node scripts/merchant-operations/validate-program.mjs
bash scripts/merchant-operations/verify-forward-migrations.sh
bash -n scripts/merchant-operations/verify-forward-migrations.sh
bash -n scripts/verify-merchant-operations.sh

echo "Merchant Operations program verification passed."
