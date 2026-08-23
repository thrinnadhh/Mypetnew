#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../apps/captain-app"

npm ci
npm run typecheck
npm run lint
npm test
EXPO_PUBLIC_API_BASE_URL="https://api.invalid.example" npx expo export --platform web --output-dir dist-ci

echo "Captain app verification passed."
