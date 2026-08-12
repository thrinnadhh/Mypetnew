#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${SERVER_PORT:-8080}"

if command -v lsof >/dev/null 2>&1; then
  listeners="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$listeners" ]]; then
    echo "Port $PORT is already in use; MyPetNew was not started."
    echo
    echo "$listeners"
    echo
    echo "Inspect the PID above and stop it only if it is safe: kill <PID>"
    echo "Then rerun: bash scripts/run-customer-dev-backend.sh"
    exit 1
  fi
fi

export SPRING_PROFILES_ACTIVE="development"
export MYPET_ENVIRONMENT="development"
export MYPET_TOKEN_SECRET="${MYPET_TOKEN_SECRET:-$(openssl rand -hex 32)}"
export MYPET_TOKEN_ISSUER="${MYPET_TOKEN_ISSUER:-mypetnew-development}"
export MYPET_TOKEN_AUDIENCE="${MYPET_TOKEN_AUDIENCE:-mypetnew-customer}"

echo "Starting MyPetNew backend in development profile on http://127.0.0.1:$PORT"
exec ./gradlew :backend:bootRun
