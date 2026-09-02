#!/usr/bin/env bash
set -euo pipefail

DB_URL="${PREVIEW_DATABASE_URL:-}"
PREVIEW_REF="${PREVIEW_PROJECT_REF:-}"
PRODUCTION_REF="${SUPABASE_PRODUCTION_PROJECT_REF:-}"

if [[ -z "$DB_URL" || -z "$PREVIEW_REF" || -z "$PRODUCTION_REF" ]]; then
  echo "Preview database URL and project refs are required." >&2
  exit 2
fi
if [[ "$PREVIEW_REF" == "$PRODUCTION_REF" ]]; then
  echo "Refusing preview-isolation verification against production." >&2
  exit 2
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for preview isolation verification." >&2
  exit 2
fi

read -r identity_count session_count order_count sale_count payment_count < <(
  psql "$DB_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
    SELECT
      (SELECT COUNT(*) FROM mypet.identity_account),
      (SELECT COUNT(*) FROM mypet.user_session),
      (SELECT COUNT(*) FROM mypet.product_order),
      (SELECT COUNT(*) FROM mypet.pos_sale),
      (SELECT COUNT(*) FROM mypet.payment);
  " | tr '|' ' '
)

for value in "$identity_count" "$session_count" "$order_count" "$sale_count" "$payment_count"; do
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Unexpected preview isolation response." >&2
    exit 1
  fi
done

if (( identity_count != 0 || session_count != 0 || order_count != 0 || sale_count != 0 || payment_count != 0 )); then
  echo "Preview branch contains user/transaction data; refusing certification." >&2
  echo "identity=$identity_count sessions=$session_count orders=$order_count pos_sales=$sale_count payments=$payment_count" >&2
  exit 1
fi

echo "Preview isolation verified: no identity, session, order, POS sale, or payment rows are present."
