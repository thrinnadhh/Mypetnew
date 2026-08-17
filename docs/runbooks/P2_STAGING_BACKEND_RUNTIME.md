# P2 — Staging backend runtime

## Objective

Boot the persistent `staging` profile against PostgreSQL/Supabase without pulling later-phase external integrations into the P2 acceptance gate.

## Runtime boundary

`staging` always uses the non-development JDBC/session/domain adapters. It never falls back to the in-memory development persistence or `FakePaymentGateway`.

P2 permits these external integrations to remain disabled:

- `CASHFREE_ENABLED=false` until P9 configures the Cashfree sandbox and public HTTPS callbacks.
- `NOTIFICATION_DELIVERY_ENABLED=false` until Firebase staging credentials are installed and push delivery is explicitly certified.

Disabling either integration does not switch the backend to development adapters. Cashfree remains represented by the persistent adapter with `available=false`; notification history/device registrations remain JDBC-backed while the Firebase sender and scheduled worker are not instantiated.

## P2 startup values

Use an ignored staging environment file based on `.env.staging.example` with real server-side database, security, and Supabase values. Do not commit or paste secrets.

Required P2 controls:

```text
SPRING_PROFILES_ACTIVE=staging
MYPET_ENVIRONMENT=staging
CASHFREE_ENABLED=false
NOTIFICATION_DELIVERY_ENABLED=false
CASHFREE_BASE_URL=https://sandbox.cashfree.com/pg
```

The staging guard still rejects mixed `development`, `device`, or `test` profiles, placeholder persistent infrastructure, and the Cashfree production endpoint. When Cashfree is enabled later, public HTTPS return/webhook URLs become mandatory.

## Verification

P2 source/CI gate:

```bash
./scripts/verify.sh
```

Runtime gate with real staging secrets:

```bash
set -a
source .env.staging
set +a
./gradlew :backend:bootRun
```

Then from another shell:

```bash
curl -fsS http://127.0.0.1:8080/actuator/health
curl -fsS http://127.0.0.1:8080/api/v1/service-regions/active
```

P2 is runtime-certified only after the staging process reports `UP` while using the persistent PostgreSQL configuration. Cashfree payment capture and Firebase push delivery remain later-phase gates.
