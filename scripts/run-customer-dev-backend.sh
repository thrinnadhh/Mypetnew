#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export SPRING_PROFILES_ACTIVE="development"
export MYPET_ENVIRONMENT="development"
export MYPET_TOKEN_SECRET="${MYPET_TOKEN_SECRET:-$(openssl rand -hex 32)}"
export MYPET_TOKEN_ISSUER="${MYPET_TOKEN_ISSUER:-mypetnew-development}"
export MYPET_TOKEN_AUDIENCE="${MYPET_TOKEN_AUDIENCE:-mypetnew-customer}"

echo "Starting MyPetNew backend in development profile on http://127.0.0.1:8080"
exec ./gradlew :backend:bootRun
