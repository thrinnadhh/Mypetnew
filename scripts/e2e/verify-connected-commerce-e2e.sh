#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail() {
  echo "Connected E2E contract violation: $*" >&2
  exit 1
}

test_file="backend/src/test/kotlin/in/mypetnew/e2e/ConnectedCommerceE2ETest.kt"
handoff_file="backend/src/main/kotlin/in/mypetnew/application/web/MerchantDeliveryHandoffController.kt"
tags_file="backend/src/test/kotlin/in/mypetnew/merchantops/testsupport/MerchantOpsTags.kt"
build_file="backend/build.gradle.kts"
workflow=".github/workflows/connected-commerce-e2e.yml"
doc="docs/qa/CONNECTED_COMMERCE_E2E.md"

for file in "$test_file" "$handoff_file" "$tags_file" "$build_file" "$workflow" "$doc"; do
  [[ -f "$file" ]] || fail "required file is missing: $file"
done

grep -Fq '@Tag("connected-e2e")' "$tags_file" || fail "connected-e2e JUnit tag is missing"
grep -Fq 'connectedE2eTest' "$build_file" || fail "dedicated Gradle E2E task is missing"
grep -Fq '@ActiveProfiles("local-isolated")' "$test_file" || fail "E2E does not run production JDBC profile"
grep -Fq 'PostgresTestDatabase.resetAndMigrate()' "$test_file" || fail "E2E does not run real Flyway migrations"
grep -Fq 'RedisContainer' "$test_file" || fail "E2E does not exercise Redis-backed dispatch presence"

for route in \
  '/api/v1/auth/merchant/otp/verify' \
  '/api/v1/admin/outlets/' \
  '/api/v1/merchant/listings' \
  '/api/v1/merchant/inventory/receive' \
  '/api/v1/auth/captain/otp/verify' \
  '/api/v1/admin/captains/' \
  '/api/v1/customer/addresses' \
  '/api/v1/customer/quotes/delivery' \
  '/api/v1/customer/orders' \
  '/delivery-handoff' \
  '/dispatch/offers' \
  '/picked-up' \
  '/delivered' \
  '/tracking'; do
  grep -Fq "$route" "$test_file" || fail "connected journey is missing route: $route"
done

if grep -Eq '^import `in`\.mypetnew\.(commerce|delivery|provider|catalog)\.domain\.(OrderService|DispatchService|ProviderService|CatalogService|InventoryService)' "$test_file"; then
  fail "E2E imports a business domain service and can bypass HTTP authority"
fi
if grep -Eq 'INSERT INTO mypet\.(product_order|dispatch_job|provider_outlet|catalog_listing|inventory_balance|inventory_reservation)' "$test_file"; then
  fail "E2E directly mutates canonical business tables"
fi
if grep -Fq 'jdbc:h2:' "$test_file"; then
  fail "connected E2E must not fall back to H2"
fi

grep -Fq 'MerchantPermission.ORDER_FULFIL' "$handoff_file" || fail "Merchant pickup handoff lacks fulfilment permission enforcement"
grep -Fq 'DispatchStatus.ASSIGNED' "$handoff_file" || fail "pickup proof is not assignment-gated"
grep -Fq 'pickupPin = job.pickupPin.takeIf' "$handoff_file" || fail "pickup proof redaction is missing"

grep -Fq ':backend:connectedE2eTest' "$workflow" || fail "workflow does not execute connected E2E task"
grep -Fq 'verify-connected-commerce-e2e.sh' "$workflow" || fail "workflow does not execute repository E2E gate"

grep -Fq 'does not certify physical Android UI' "$doc" || fail "physical-device truth boundary is missing"
grep -Fq 'does not certify external Cashfree or FCM delivery' "$doc" || fail "external-provider truth boundary is missing"

echo "Connected commerce E2E repository contract passed."
