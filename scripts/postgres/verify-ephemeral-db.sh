#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-}"

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"

case "$PGHOST" in
  127.0.0.1|localhost) ;;
  *)
    echo "Ephemeral DB verification only permits loopback PostgreSQL; received '$PGHOST'." >&2
    exit 2
    ;;
esac

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for ephemeral PostgreSQL verification." >&2
  exit 2
fi

psql_cmd=(psql -X -A -t -v ON_ERROR_STOP=1)

case "$MODE" in
  preflight)
    table_count="$("${psql_cmd[@]}" -c "
      SELECT COUNT(*)
      FROM information_schema.tables
      WHERE table_schema = 'mypet';
    ")"
    if [[ ! "$table_count" =~ ^[0-9]+$ ]]; then
      echo "Unexpected ephemeral preflight response." >&2
      exit 1
    fi
    if (( table_count != 0 )); then
      echo "Ephemeral PostgreSQL is not empty before migration: mypet tables=$table_count." >&2
      exit 1
    fi
    echo "Ephemeral PostgreSQL preflight passed: fresh database, no mypet tables."
    ;;

  postflight)
    mapfile -t migration_files < <(
      find "$ROOT/backend/src/main/resources/db/migration" -maxdepth 1 -type f -name 'V*__*.sql' -print | sort -V
    )
    if (( ${#migration_files[@]} == 0 )); then
      echo "No repository Flyway migrations found." >&2
      exit 1
    fi

    repo_latest=0
    for file in "${migration_files[@]}"; do
      base="$(basename "$file")"
      if [[ "$base" =~ ^V([0-9]+)__ ]]; then
        version=$((10#${BASH_REMATCH[1]}))
        (( version > repo_latest )) && repo_latest="$version"
      fi
    done

    read -r live_latest failed_count < <(
      "${psql_cmd[@]}" -c "
        SELECT
          COALESCE(MAX(version::integer) FILTER (WHERE success AND version ~ '^[0-9]+$'), 0),
          COUNT(*) FILTER (WHERE NOT success)
        FROM mypet.flyway_schema_history;
      " | tr '|' ' '
    )

    if [[ ! "$live_latest" =~ ^[0-9]+$ || ! "$failed_count" =~ ^[0-9]+$ ]]; then
      echo "Unexpected Flyway history response from ephemeral PostgreSQL." >&2
      exit 1
    fi
    if (( failed_count != 0 || live_latest != repo_latest )); then
      echo "Ephemeral Flyway mismatch: repository V${repo_latest}, live V${live_latest}, failed=${failed_count}." >&2
      exit 1
    fi

    read -r identity_count session_count order_count sale_count payment_count < <(
      "${psql_cmd[@]}" -c "
        SELECT
          (SELECT COUNT(*) FROM mypet.identity_account),
          (SELECT COUNT(*) FROM mypet.user_session),
          (SELECT COUNT(*) FROM mypet.product_order),
          (SELECT COUNT(*) FROM mypet.pos_sale),
          (SELECT COUNT(*) FROM mypet.payment);
      " | tr '|' ' '
    )

    for value in "$identity_count" "$session_count" "$order_count" "$sale_count" "$payment_count"; do
      [[ "$value" =~ ^[0-9]+$ ]] || {
        echo "Unexpected data-isolation response from ephemeral PostgreSQL." >&2
        exit 1
      }
    done
    if (( identity_count != 0 || session_count != 0 || order_count != 0 || sale_count != 0 || payment_count != 0 )); then
      echo "Ephemeral PostgreSQL unexpectedly contains identity/transaction rows." >&2
      exit 1
    fi

    echo "Ephemeral PostgreSQL certified: Flyway V${live_latest}; failed=0; transactional seed data=0."
    ;;

  *)
    echo "Usage: $0 <preflight|postflight>" >&2
    exit 2
    ;;
esac
