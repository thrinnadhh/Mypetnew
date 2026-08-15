#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

./scripts/secret-scan.sh
./scripts/privacy-security-scan.sh
./gradlew :backend:check --no-daemon --no-configuration-cache

echo "Backend source verification passed."
