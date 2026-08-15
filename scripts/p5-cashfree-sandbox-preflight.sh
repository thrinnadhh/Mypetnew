#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'P5 sandbox preflight: FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'P5 sandbox preflight: OK: %s\n' "$1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

require_env CASHFREE_ENABLED
require_env CASHFREE_CLIENT_ID
require_env CASHFREE_CLIENT_SECRET
require_env CASHFREE_API_VERSION
require_env CASHFREE_WEBHOOK_VERSION
require_env CASHFREE_BASE_URL
require_env CASHFREE_RETURN_URL
require_env CASHFREE_NOTIFY_URL
require_env DATABASE_URL
require_env EXPO_PUBLIC_APP_ENV
require_env EXPO_PUBLIC_API_BASE_URL

[[ "$CASHFREE_ENABLED" == "true" ]] || fail 'CASHFREE_ENABLED must be true for sandbox certification'
[[ ${#CASHFREE_CLIENT_SECRET} -ge 16 ]] || fail 'CASHFREE_CLIENT_SECRET is too short'
[[ "$CASHFREE_API_VERSION" == "2025-01-01" ]] || fail 'CASHFREE_API_VERSION must be 2025-01-01'
[[ "$CASHFREE_WEBHOOK_VERSION" == "2025-01-01" ]] || fail 'CASHFREE_WEBHOOK_VERSION must be 2025-01-01'
[[ "${CASHFREE_BASE_URL%/}" == "https://sandbox.cashfree.com/pg" ]] || fail 'CASHFREE_BASE_URL must target Cashfree sandbox'
[[ "$DATABASE_URL" == jdbc:postgresql://* ]] || fail 'DATABASE_URL must use PostgreSQL for certification'
[[ "$EXPO_PUBLIC_APP_ENV" == "staging" ]] || fail 'EXPO_PUBLIC_APP_ENV must be staging for sandbox certification'
[[ "$EXPO_PUBLIC_API_BASE_URL" == https://* ]] || fail 'EXPO_PUBLIC_API_BASE_URL must be HTTPS'
[[ "$CASHFREE_RETURN_URL" == https://* ]] || fail 'CASHFREE_RETURN_URL must be HTTPS'
[[ "$CASHFREE_NOTIFY_URL" == https://* ]] || fail 'CASHFREE_NOTIFY_URL must be HTTPS'

case "$CASHFREE_RETURN_URL" in
  *://localhost*|*://127.0.0.1*|*://0.0.0.0*|*://\[::1\]*)
    fail 'CASHFREE_RETURN_URL must use a public host'
    ;;
esac

case "$CASHFREE_NOTIFY_URL" in
  *://localhost*|*://127.0.0.1*|*://0.0.0.0*|*://\[::1\]*)
    fail 'CASHFREE_NOTIFY_URL must use a public host'
    ;;
esac

api_base="${EXPO_PUBLIC_API_BASE_URL%/}"
expected_notify="${api_base}/api/v1/webhooks/cashfree/payments"
[[ "$CASHFREE_NOTIFY_URL" == "$expected_notify" ]] || \
  fail "CASHFREE_NOTIFY_URL must equal ${expected_notify}"

pass 'sandbox environment contract is internally consistent'
pass 'Cashfree credentials are present without being printed'
pass 'Customer staging API and Cashfree webhook share the deployed backend origin'
pass 'Cashfree REST and webhook versions are pinned to 2025-01-01'

if [[ "${P5_PROBE_PUBLIC_ENDPOINT:-0}" == "1" ]]; then
  command -v curl >/dev/null 2>&1 || fail 'curl is required when P5_PROBE_PUBLIC_ENDPOINT=1'

  health_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    --max-time 10 "${api_base}/actuator/health")" || fail 'backend health endpoint is unreachable'
  [[ "$health_status" == "200" ]] || fail "backend health returned HTTP ${health_status}"
  pass 'public backend health endpoint returned HTTP 200'

  probe_file="$(mktemp)"
  trap 'rm -f "$probe_file"' EXIT
  webhook_status="$(curl --silent --show-error --output "$probe_file" --write-out '%{http_code}' \
    --max-time 10 \
    --request POST \
    --header 'Content-Type: application/json' \
    --data '{}' \
    "$CASHFREE_NOTIFY_URL")" || fail 'public Cashfree webhook endpoint is unreachable'

  case "$webhook_status" in
    400|401|403|422)
      pass "unsigned webhook probe was rejected with HTTP ${webhook_status}"
      ;;
    200)
      fail 'unsigned webhook probe returned HTTP 200; signature boundary is not fail-closed'
      ;;
    404)
      fail 'Cashfree webhook endpoint returned HTTP 404'
      ;;
    5*)
      fail "Cashfree webhook endpoint returned HTTP ${webhook_status}"
      ;;
    *)
      fail "unexpected unsigned webhook response HTTP ${webhook_status}"
      ;;
  esac
fi

printf '\nP5 sandbox preflight passed. No live payment was attempted by this script.\n'
