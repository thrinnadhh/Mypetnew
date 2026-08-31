#!/usr/bin/env bash
set -euo pipefail

node "$(dirname "$0")/merchant-app/verify-route-hygiene.mjs"
node --test "$(dirname "$0")/merchant-app/verify-route-hygiene.test.mjs"

cd "$(dirname "$0")/../apps/merchant-app"

npm ci
npm run check:routes
npm run typecheck
npm run lint
npm test
EXPO_PUBLIC_API_BASE_URL="https://api.invalid.example" npx expo export --platform web --output-dir dist-ci
