# Staging runtime

## Purpose

`staging` is the persistent end-to-end environment. It exercises the non-development JDBC-backed domain/session adapters while keeping production credentials and traffic isolated.

## Profile contract

### `development`

Use for local feature work and fast API/UI iteration.

- in-memory provider/catalog/order/appointment/customer adapters
- `FakePaymentGateway`
- Firebase delivery disabled by profile
- real Cashfree disabled by profile
- not valid evidence for persistent transaction or payment certification

Start from `.env.example`.

### `staging`

Use for persistent marketplace and integration E2E.

- JDBC/PostgreSQL persistence
- durable sessions and marketplace state
- persistent Cashfree adapter (may be unavailable until P9)
- persistent notification history/device-registration state
- Firebase sender/worker enabled only when `NOTIFICATION_DELIVERY_ENABLED=true`
- must not be combined with `test`, `development`, or `device`

Start from `.env.staging.example` and replace persistent-infrastructure placeholders through the deployment secret store or an ignored local secret file.

## Phased integration gates

P2 proves the persistent backend can boot without forcing later external-provider certification:

```text
CASHFREE_ENABLED=false
NOTIFICATION_DELIVERY_ENABLED=false
```

This does not select development fakes. Staging still uses JDBC persistence and the non-development payment configuration. Cashfree reports unavailable until P9 enables the sandbox. Notification records remain durable while the Firebase provider and scheduled delivery worker are absent.

P9 enables Cashfree only after credentials and public HTTPS callbacks exist. When enabled, the staging runtime requires the sandbox base URL and the canonical public HTTPS webhook URL.

Firebase delivery may be enabled later by setting `NOTIFICATION_DELIVERY_ENABLED=true` and installing Google application credentials for the staging Firebase project.

## Fail-closed staging guard

When the `staging` profile is active, startup deliberately fails if any of these are true:

1. `development`, `test`, or `device` is active at the same time;
2. the JDBC URL is not PostgreSQL or still uses an example host;
3. the Supabase URL is still a placeholder;
4. `MYPET_ENVIRONMENT` is not `staging`;
5. Cashfree points to the production endpoint instead of the sandbox endpoint;
6. when Cashfree is enabled, return/notify URLs are not public HTTPS URLs;
7. when Cashfree is enabled, the notify URL is not exactly `/api/v1/webhooks/cashfree/payments`.

## Local development

```bash
cp .env.example .env
# replace local-only database/security placeholders
set -a
source .env
set +a
./gradlew :backend:bootRun
```

Expected active profile: `development`.

## Staging preflight

Do not overwrite the local development `.env` with staging credentials. Create a separate ignored staging file:

```bash
cp .env.staging.example .env.staging
# replace persistent backend placeholders locally or use a deployment secret manager
set -a
source .env.staging
set +a
```

Before starting the server, verify presence without printing secrets:

```bash
for v in \
  SPRING_PROFILES_ACTIVE \
  DATABASE_URL \
  DATABASE_USERNAME \
  DATABASE_PASSWORD \
  MYPET_TOKEN_SECRET \
  MYPET_DEVICE_TOKEN_KEY \
  SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY \
  FIREBASE_PROJECT_ID \
  CASHFREE_ENABLED \
  NOTIFICATION_DELIVERY_ENABLED
do
  [ -n "$(printenv "$v")" ] && echo "SET $v" || echo "MISSING $v"
done
```

Then start:

```bash
./gradlew :backend:bootRun
```

The P2 runtime is not certified until `/actuator/health` is `UP` under the `staging` profile and the persistent public service-region/catalog/provider APIs can be queried. Cashfree capture/webhooks and Firebase delivery remain separate later-phase certification gates.

## Security boundary

Never commit or paste:

- database password
- Supabase service-role/secret key
- MyPet token/device encryption secrets
- Cashfree client secret
- Firebase service-account JSON

Staging must use sandbox/test credentials only. Production Cashfree credentials and the production Cashfree endpoint are outside this profile.
