#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'P5 Checkpoint 3 evidence: FAIL: %s\n' "$1" >&2
  exit 1
}

pass() {
  printf 'P5 Checkpoint 3 evidence: OK: %s\n' "$1"
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "$name is required"
}

command -v psql >/dev/null 2>&1 || fail 'psql is required'

require_env PGHOST
require_env PGDATABASE
require_env PGUSER
require_env P5_ORDER_ID
require_env P5_PAYMENT_ID
require_env P5_EXPECTED_SCENARIO

uuid_regex='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
[[ "$P5_ORDER_ID" =~ $uuid_regex ]] || fail 'P5_ORDER_ID must be a UUID'
[[ "$P5_PAYMENT_ID" =~ $uuid_regex ]] || fail 'P5_PAYMENT_ID must be a UUID'

case "$P5_EXPECTED_SCENARIO" in
  success|failed|user_dropped|refund|late_capture)
    ;;
  *)
    fail 'P5_EXPECTED_SCENARIO must be one of: success, failed, user_dropped, refund, late_capture'
    ;;
esac

export PGPORT="${PGPORT:-5432}"
export PGSSLMODE="${PGSSLMODE:-require}"

evidence_dir="${P5_EVIDENCE_DIR:-}"
if [[ -z "$evidence_dir" ]]; then
  evidence_dir="$(mktemp -d "${TMPDIR:-/tmp}/mypet-p5-checkpoint3.XXXXXX")"
else
  mkdir -p "$evidence_dir"
fi

psql_base=(psql -X -v ON_ERROR_STOP=1 -v "order_id=$P5_ORDER_ID" -v "payment_id=$P5_PAYMENT_ID")

"${psql_base[@]}" -P format=csv -c "
SELECT po.id AS order_id,
       po.status AS order_status,
       po.payment_method,
       po.payment_status AS order_payment_status,
       po.grand_total_paise AS order_amount_paise,
       po.payment_hold_expires_at,
       p.id AS payment_id,
       p.status AS payment_status,
       p.amount_paise AS payment_amount_paise,
       p.currency,
       p.provider,
       p.provider_order_reference,
       p.reconciliation_required,
       p.reconciliation_attempts,
       p.captured_at,
       p.created_at,
       p.updated_at
FROM mypet.product_order po
JOIN mypet.payment p
  ON p.reference_type = 'PRODUCT_ORDER'
 AND p.reference_id = po.id
WHERE po.id = :'order_id'::uuid
  AND p.id = :'payment_id'::uuid;
" > "$evidence_dir/canonical-payment-order.csv"

"${psql_base[@]}" -P format=csv -c "
SELECT provider,
       provider_payment_id,
       outcome,
       payment_amount_paise,
       payment_currency,
       provider_payment_time,
       safe_error_code,
       created_at,
       updated_at
FROM mypet.payment_attempt
WHERE payment_id = :'payment_id'::uuid
ORDER BY created_at, id;
" > "$evidence_dir/payment-attempts.csv"

"${psql_base[@]}" -P format=csv -c "
SELECT from_status,
       to_status,
       reason_code,
       source_identity,
       occurred_at
FROM mypet.payment_history
WHERE payment_id = :'payment_id'::uuid
ORDER BY occurred_at, id;
" > "$evidence_dir/payment-history.csv"

"${psql_base[@]}" -P format=csv -c "
SELECT delivery_identity,
       webhook_version,
       event_type,
       provider_payment_id,
       attempt_status,
       order_amount_paise,
       order_currency,
       payment_amount_paise,
       payment_currency,
       payload_sha256,
       processing_status,
       retry_count,
       last_safe_error,
       received_at,
       processed_at
FROM mypet.payment_webhook_inbox
WHERE provider = 'CASHFREE'
  AND provider_order_reference = (
      SELECT provider_order_reference FROM mypet.payment WHERE id = :'payment_id'::uuid
  )
ORDER BY received_at, id;
" > "$evidence_dir/webhook-inbox.csv"

"${psql_base[@]}" -P format=csv -c "
SELECT id,
       status,
       amount_paise,
       currency,
       provider_refund_id,
       execution_state,
       reconciliation_required,
       reconciliation_attempts,
       completed_at,
       created_at,
       updated_at
FROM mypet.payment_refund
WHERE payment_id = :'payment_id'::uuid
ORDER BY created_at, id;
" > "$evidence_dir/refunds.csv"

"${psql_base[@]}" -P format=csv -c "
SELECT im.listing_id,
       im.reason,
       im.source_reference,
       COUNT(*) AS movement_count
FROM mypet.inventory_movement im
JOIN mypet.product_order_line pol ON pol.listing_id = im.listing_id
WHERE pol.order_id = :'order_id'::uuid
  AND im.reason = 'ORDER_RELEASE'
GROUP BY im.listing_id, im.reason, im.source_reference
ORDER BY im.listing_id, im.source_reference;
" > "$evidence_dir/inventory-releases.csv"

"${psql_base[@]}" -v "scenario=$P5_EXPECTED_SCENARIO" -At -F $'\t' -c "
WITH canonical AS (
    SELECT po.id AS order_id,
           po.status AS order_status,
           po.payment_status AS order_payment_status,
           po.grand_total_paise AS order_amount_paise,
           p.id AS payment_id,
           p.status AS payment_status,
           p.amount_paise AS payment_amount_paise,
           p.currency,
           p.provider_order_reference
    FROM mypet.product_order po
    JOIN mypet.payment p
      ON p.reference_type = 'PRODUCT_ORDER'
     AND p.reference_id = po.id
    WHERE po.id = :'order_id'::uuid
      AND p.id = :'payment_id'::uuid
),
stats AS (
    SELECT
      (SELECT COUNT(*) FROM canonical) AS canonical_count,
      (SELECT COUNT(*) FROM mypet.payment_attempt WHERE payment_id = :'payment_id'::uuid) AS attempt_count,
      (SELECT COUNT(*) FROM mypet.payment_history WHERE payment_id = :'payment_id'::uuid AND to_status = 'CAPTURED') AS capture_count,
      (SELECT COUNT(*) FROM (
          SELECT provider, provider_payment_id
          FROM mypet.payment_attempt
          WHERE payment_id = :'payment_id'::uuid
          GROUP BY provider, provider_payment_id
          HAVING COUNT(*) > 1
      ) d) AS duplicate_attempt_ids,
      (SELECT COUNT(*) FROM mypet.payment_webhook_inbox
       WHERE provider = 'CASHFREE'
         AND provider_order_reference = (SELECT provider_order_reference FROM canonical)) AS webhook_count,
      (SELECT COUNT(*) FROM mypet.payment_webhook_inbox
       WHERE provider = 'CASHFREE'
         AND provider_order_reference = (SELECT provider_order_reference FROM canonical)
         AND webhook_version <> '2025-01-01') AS wrong_webhook_version_count,
      (SELECT COUNT(*) FROM mypet.payment_refund WHERE payment_id = :'payment_id'::uuid) AS refund_count,
      (SELECT COUNT(*) FROM mypet.payment_refund WHERE payment_id = :'payment_id'::uuid AND status = 'SUCCESS') AS successful_refund_count,
      (SELECT COUNT(*) FROM mypet.payment_attempt WHERE payment_id = :'payment_id'::uuid AND outcome = 'FAILED') AS failed_attempt_count,
      (SELECT COUNT(*) FROM mypet.payment_attempt WHERE payment_id = :'payment_id'::uuid AND outcome = 'USER_DROPPED') AS dropped_attempt_count,
      (SELECT COALESCE(MAX(movement_count), 0) FROM (
          SELECT COUNT(*) AS movement_count
          FROM mypet.inventory_movement im
          JOIN mypet.product_order_line pol ON pol.listing_id = im.listing_id
          WHERE pol.order_id = :'order_id'::uuid
            AND im.reason = 'ORDER_RELEASE'
          GROUP BY im.listing_id, im.source_reference
      ) releases) AS max_release_count
)
SELECT 'canonical-row', CASE WHEN canonical_count = 1 THEN 'PASS' ELSE 'FAIL' END, canonical_count::text FROM stats
UNION ALL
SELECT 'amount-match', CASE WHEN EXISTS (
    SELECT 1 FROM canonical WHERE order_amount_paise = payment_amount_paise AND currency = 'INR'
) THEN 'PASS' ELSE 'FAIL' END, COALESCE((SELECT order_amount_paise::text || '/' || payment_amount_paise::text FROM canonical), 'missing')
UNION ALL
SELECT 'duplicate-provider-payment-id', CASE WHEN duplicate_attempt_ids = 0 THEN 'PASS' ELSE 'FAIL' END, duplicate_attempt_ids::text FROM stats
UNION ALL
SELECT 'webhook-version', CASE WHEN webhook_count > 0 AND wrong_webhook_version_count = 0 THEN 'PASS' ELSE 'FAIL' END, webhook_count::text || ' webhooks; wrong=' || wrong_webhook_version_count::text FROM stats
UNION ALL
SELECT 'success-capture', CASE WHEN :'scenario' <> 'success' OR EXISTS (
    SELECT 1 FROM canonical WHERE payment_status = 'CAPTURED' AND order_payment_status = 'PAID'
) AND capture_count = 1 THEN 'PASS' ELSE 'FAIL' END, capture_count::text FROM stats
UNION ALL
SELECT 'failed-attempt', CASE WHEN :'scenario' <> 'failed' OR (
    failed_attempt_count > 0 AND NOT EXISTS (SELECT 1 FROM canonical WHERE payment_status = 'CAPTURED' OR order_payment_status = 'PAID')
) THEN 'PASS' ELSE 'FAIL' END, failed_attempt_count::text FROM stats
UNION ALL
SELECT 'user-dropped-attempt', CASE WHEN :'scenario' <> 'user_dropped' OR (
    dropped_attempt_count > 0 AND NOT EXISTS (SELECT 1 FROM canonical WHERE payment_status = 'CAPTURED' OR order_payment_status = 'PAID')
) THEN 'PASS' ELSE 'FAIL' END, dropped_attempt_count::text FROM stats
UNION ALL
SELECT 'refund-final', CASE WHEN :'scenario' <> 'refund' OR (
    refund_count = 1 AND successful_refund_count = 1 AND EXISTS (
      SELECT 1 FROM canonical WHERE payment_status = 'CAPTURED' AND order_payment_status = 'REFUNDED'
    )
) THEN 'PASS' ELSE 'FAIL' END, refund_count::text || '/' || successful_refund_count::text FROM stats
UNION ALL
SELECT 'late-capture-policy', CASE WHEN :'scenario' <> 'late_capture' OR (
    capture_count = 1 AND refund_count = 1 AND max_release_count <= 1 AND EXISTS (
      SELECT 1 FROM canonical
      WHERE payment_status = 'CAPTURED'
        AND order_status = 'CANCELLED'
        AND order_payment_status IN ('REFUND_PENDING', 'REFUNDED')
    )
) THEN 'PASS' ELSE 'FAIL' END, 'captures=' || capture_count::text || ', refunds=' || refund_count::text || ', max-release=' || max_release_count::text FROM stats
ORDER BY 1;
" > "$evidence_dir/checks.tsv"

if grep -q $'\tFAIL\t' "$evidence_dir/checks.tsv"; then
  cat "$evidence_dir/checks.tsv" >&2
  fail "scenario $P5_EXPECTED_SCENARIO did not satisfy all canonical invariants; evidence kept at $evidence_dir"
fi

cat "$evidence_dir/checks.tsv"
pass "scenario $P5_EXPECTED_SCENARIO satisfies the automated database evidence gate"
printf 'Evidence directory: %s\n' "$evidence_dir"
printf 'No Cashfree secret, PAN, CVV, UPI PIN, or raw webhook payload is collected by this script.\n'
