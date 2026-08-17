# Staging runtime

## Purpose

`staging` is the persistent end-to-end environment. It must exercise the same JDBC-backed domain adapters and real Cashfree sandbox adapter that production-like flows depend on, while remaining isolated from production credentials and traffic.

## Profile contract

### `development`

Use for local feature work and fast API/UI iteration.

- in-memory provider/catalog/order/appointment/customer adapters
- `FakePaymentGateway`
- Firebase delivery disabled
- real Cashfree disabled
- not valid evidence for persistent transaction or payment certification

Start from `.env.example`.

### `staging`

Use for persistent marketplace and payment E2E.

- JDBC/PostgreSQL persistence
- durable sessions and marketplace state
- real Cashfree adapter against `https://sandbox.cashfree.com/pg`
- Firebase/notification infrastructure enabled as configured
- public HTTPS Cashfree return and webhook URLs required
- must not be combined with `test`, `development`, or `device`

Start from `.env.staging.example` and replace every placeholder through the deployment secret store or an ignored local secret file.

## Fail-closed staging guard

When the `staging` profile is active, startup deliberately fails if any of these are true:

1. `development`, `test`, or `device` is active at the same time;
2. the JDBC URL is not PostgreSQL or still uses an example host;
3. the Supabase URL is still a placeholder;
4. `MYPET_ENVIRONMENT` is not `staging`;
5. `CASHFREE_ENABLED` is not `true`;
6. Cashfree is pointed at the production endpoint instead of the sandbox endpoint;
7. Cashfree return/notify URLs are not public HTTPS URLs;
8. the notify URL is not exactly `/api/v1/webhooks/cashfree/payments`.

This prevents a staging boot from silently falling back to fake/offline payment behavior.

## Local development

```bash
cp .env.example .env
# replace local-only database/security placeholders
set -a
source .env
set +a
./gradlew :backend:bootRun
```

Expected active profile:

```text
development
```

## Staging preflight

Do not overwrite the local development `.env` with staging credentials. Create a separate ignored staging file:

```bash
cp .env.staging.example .env.staging
# replace placeholders locally or use the deployment secret manager
set -a
source .env.staging
set +a
```

Before starting the server, verify values without printing secrets:

```bash
for v in \
  SPRING_PROFILES_ACTIVE \
  DATABASE_URL \
  DATABASE_USERNAME \
  DATABASE_PASSWORD \
  MYPET_TOKEN_SECRET \
  SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  FIREBASE_PROJECT_ID \
  GOOGLE_APPLICATION_CREDENTIALS \
  CASHFREE_ENABLED \
  CASHFREE_CLIENT_ID \
  CASHFREE_CLIENT_SECRET \
  CASHFREE_RETURN_URL \
  CASHFREE_NOTIFY_URL
do
  [ -n "$(printenv "$v")" ] && echo "SET $v" || echo "MISSING $v"
done
```

Then start:

```bash
./gradlew :backend:bootRun
```

The staging runtime is not considered ready until `/actuator/health` is `UP` and the persistent public catalog/provider APIs return the expected staging data.

## Security boundary

Never commit or paste:

- database password
- Supabase service-role/secret key
- MyPet token secret
- Cashfree client secret
- Firebase service-account JSON

Staging must use sandbox/test credentials only. Production Cashfree credentials and the production Cashfree endpoint are explicitly outside this profile.
