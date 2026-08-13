#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../apps/merchant-app"

npm install --no-audit --no-fund
npm run typecheck
npm run lint
npm test
