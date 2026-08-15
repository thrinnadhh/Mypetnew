#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/secret-scan.sh
./scripts/privacy-security-scan.sh
bash -n ./scripts/p5-cashfree-sandbox-preflight.sh
bash -n ./scripts/p5-cashfree-checkpoint3-evidence.sh
./gradlew :backend:check --no-daemon --no-configuration-cache

echo "Backend source verification passed."
