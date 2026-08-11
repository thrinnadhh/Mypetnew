#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/secret-scan.sh
./gradlew :backend:check --no-daemon --no-configuration-cache
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:coverage
corepack pnpm build

echo "Local Sprint 1 source verification passed. Staging and physical-device gates remain separate."
