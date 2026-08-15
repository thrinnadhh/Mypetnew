# Plan 5 payment privacy, security and retention addendum

Status: source-verified Plan 5 implementation addendum, 2026-08-15. Deployment, Cashfree merchant-account, contract, processor-region and live sandbox evidence remain separate production gates.

Scope: ProductOrder online payment through Cashfree only. `APPOINTMENT` runtime remains fail-closed until Plan 8. This addendum supersedes older source-inventory statements that said Cashfree was not integrated.

## 1. Authority and minimisation

MyPet remains authoritative for authenticated Customer identity, ProductOrder ownership, payable amount/currency, order lifecycle, refund policy and Customer-facing payment projection. Cashfree is authoritative only for provider payment/refund facts after MyPet verifies identifiers, amount/currency and provider authenticity.

The Customer payment initiation request contains only `referenceType`, `referenceId` and `provider`, plus the `Idempotency-Key` header. It does not accept authoritative `customerId`, `userId`, amount, currency, payment status, provider identifiers, refund amount or success state. Native/browser callbacks are advisory only and always lead to backend verification.

MyPet must never collect, persist or log PAN, card number, CVV/CVC, UPI PIN, bank password, payment instrument details or Cashfree secret credentials. The Cashfree native/hosted interface owns payment-instrument collection.

## 2. Data inventory

| Store / field group | Purpose | Classification | Access boundary | Retention / deletion |
|---|---|---|---|---|
| `product_order.payment_method`, `payment_status`, `payment_hold_expires_at` | canonical checkout/payment projection and inventory hold | CONFIDENTIAL transaction metadata | owning Customer, fulfilling Merchant where already authorized, backend workers/support | follows ProductOrder legal/consumer record; direct identity follows existing deletion/tombstone policy |
| `payment`: Customer/order/provider linkage, exact paise/currency, server provider order/idempotency references, canonical status, safe provider-session reference, reconciliation metadata/timestamps | create/reconcile one provider payment without duplicate charging | Customer/provider refs RESTRICTED; amount/status CONFIDENTIAL | payment service/worker; owned Customer projection; authorized operations only | `LEGAL_RETENTION` with ProductOrder/financial dispute record; exact period requires counsel; provider session reference may be purged earlier once no longer operationally required |
| `payment_initiation_command`: Customer UUID, bounded idempotency key, SHA-256 request fingerprint, Payment UUID | durable replay/concurrency safety for every accepted client command key | CONFIDENTIAL | payment persistence/operations only | retain while the Payment can be retried/disputed; purge/anonymise with Payment retention decision |
| `payment_attempt`: Payment UUID, Cashfree `cf_payment_id`, SUCCESS/FAILED/USER_DROPPED, exact normalized amount/currency, provider time, bounded safe error code/reason | provider attempt truth, duplicate/out-of-order handling and dispute evidence | provider ID RESTRICTED; status/amount CONFIDENTIAL | payment worker/reconciliation/operations | financial/dispute retention aligned to Payment; no instrument or bank/card payload retained |
| `payment_history` | immutable canonical Payment transitions and source identity | CONFIDENTIAL | payment/audit operations | aligned to Payment financial/dispute retention |
| `payment_webhook_inbox`: delivery identity, webhook version/event type, provider order/payment IDs, separate order/payment paise/currency, provider times, payload SHA-256, bounded safe error, processing lease/retry metadata | durable at-least-once webhook processing without retaining raw signed body | provider IDs RESTRICTED; normalized event CONFIDENTIAL | webhook ingress + payment worker only | operational target: processed rows 90 days, then delete unless linked incident/dispute/legal hold; failed/dead operational evidence retained until resolved plus review period; raw body is never retained after verification |
| `payment_refund`: Payment link, canonical full-refund amount/currency, deterministic provider refund/idempotency IDs, status/execution/reconciliation metadata | ensure exactly one durable full-refund obligation and restart-safe provider execution | provider/refund IDs RESTRICTED; amount/status CONFIDENTIAL | payment/refund workers, authorized operations, owned Customer projection | aligned to Payment/order legal/dispute retention |
| `payment_refund_history` | immutable refund transition evidence | CONFIDENTIAL | payment/audit operations | aligned to Refund/Payment retention |
| Customer AsyncStorage `mypet.customer.pending-payment.v1`: `paymentId`, `orderId` only | restart-safe verification resume | CONFIDENTIAL opaque identifiers | Customer app sandbox only | removed on CAPTURED/FAILED/EXPIRED completion; app data deletion also removes it; no token, amount, callback truth or payment instrument stored |

## 3. Data flow

```text
Authenticated Customer
  -> quote(paymentMethod)
  -> ProductOrder(PLACED, server amount, optional 15-minute online hold)
  -> POST /api/v1/customer/payments { referenceType, referenceId, provider }
  -> backend derives Customer + order + INR amount
  -> durable Payment/provider identity commit
  -> Cashfree Create Order outside PostgreSQL transaction
  -> safe session metadata commit
  -> Customer Cashfree native SDK
  -> callback means VERIFY ONLY
  -> GET owned Payment status

Cashfree webhook
  -> exact raw body + required headers
  -> HMAC/version verification BEFORE JSON trust
  -> normalized safe event + payload SHA-256 persisted
  -> raw body discarded
  -> async worker/reconciliation
  -> ProductOrder -> Payment -> Refund lock order
  -> PAID, or terminal order + one durable full-refund obligation

Refund
  -> terminal paid ProductOrder or late capture
  -> Refund intent committed before provider I/O
  -> Cashfree Create/Get Refund outside DB transaction
  -> backend confirmation
  -> ProductOrder REFUNDED only on confirmed provider refund success
```

No mobile callback, redirect, Customer field or Merchant action can create `CAPTURED` payment truth.

## 4. Processor boundary

Cashfree receives only data required for provider order/payment operation: server-generated provider order/reference identity, exact INR amount/currency, bounded Customer reference and Customer mobile required by the selected provider order API, plus server return/notify metadata when configured. MyPet does not intentionally transmit saved delivery address, pet/veterinary data, loyalty data, PAN/CVV/UPI PIN or unrelated profile fields.

Source implementation pins separate `CASHFREE_API_VERSION` and `CASHFREE_WEBHOOK_VERSION`. Server credentials are configuration-only and must never be present in the Customer app or committed repository.

Production remains blocked until accountable release evidence captures Cashfree merchant terms/DPA where applicable, provider/subprocessor list, country/region and transfer analysis, provider retention/deletion policy, breach/incident cooperation, sandbox credentials/configuration and webhook retry evidence. Unknown provider-region facts must remain `UNKNOWN`, not inferred from branding.

## 5. Retention and account deletion

Payment/refund records can be transaction/legal/dispute records and therefore are not automatically hard-deleted with Customer account erasure. Existing deleted-identity tombstone/pseudonymisation rules continue to separate the deleted Customer from lawfully retained transaction rows. Exact statutory retention duration remains legal-counsel evidence, not a source-code assumption.

The following may be deleted earlier because they are operational rather than financial truth when no incident/dispute/legal hold applies:

- processed normalized webhook inbox rows: target 90 days;
- stale provider session references after their operational recovery window;
- Customer local pending-payment recovery IDs after terminal server state.

Backups/restores must preserve deletion tombstones and must not resurrect direct Customer identifiers.

## 6. Logging classification

Forbidden in logs, traces, dead letters and audit free text:

- Cashfree client secret or authentication headers;
- exact raw signed webhook body;
- PAN/card number, CVV/CVC, UPI PIN, bank credentials or payment instrument structures;
- full Customer mobile/address copied merely for debugging;
- provider response payloads containing unnecessary Customer/instrument details.

Allowed operational telemetry is bounded to opaque IDs, canonical status, provider-safe error codes, trace IDs, retry/lease metadata and payload SHA-256 where necessary. Error paths must redact provider response content rather than log it wholesale.

## 7. Threat model delta

| Threat | Control / required evidence |
|---|---|
| Customer alters amount or identity | payment POST accepts no amount/Customer authority; backend derives owned ProductOrder and INR amount |
| Callback/redirect spoofs success | native callback only starts `Verifying payment…`; canonical GET state decides UI; cart clears only on CAPTURED |
| Webhook forgery | exact raw-body HMAC-SHA256 with timestamp and server secret; constant-time comparison; configured webhook-version validation |
| Webhook replay/duplicate | durable provider delivery identity uniqueness plus `cf_payment_id` uniqueness and idempotent history/effects |
| Duplicate provider order | one Payment per reference/provider; deterministic provider order ID + stable provider idempotency key persisted before external I/O |
| Network timeout creates duplicate charge | ambiguous provider call maps to UNKNOWN/reconciliation; same provider identity reused |
| Failed attempt hides later success | actual attempts are distinct by `cf_payment_id`; FAILED/USER_DROPPED do not regress/terminally overwrite canonical later capture truth |
| Under/overpayment or currency substitution | exact BigDecimal-to-paise conversion; provider order amount/currency and payment amount/currency validated against canonical Payment; mismatch fails closed |
| Capture versus expiry/cancel race | global aggregate order `ProductOrder -> Payment -> Refund`; DB locks/unique constraints; no JVM-only correctness |
| Late capture loses Customer money | Payment remains CAPTURED provider truth; invalid order never resurrects; same transaction creates/reuses one full Refund intent and `REFUND_PENDING` |
| Crash after cancellation before refund | terminal order transaction includes refund intent before Cashfree HTTP |
| Duplicate refund | unique Refund per Payment, deterministic provider refund identity/idempotency; ambiguous execution reconciles before safe retry |
| Secret/payment-instrument leakage | server-only config, raw-body discard, normalized inbox, restricted logging/data inventory; client SDK owns instrument collection |
| IDOR | Customer payment GET binds authenticated Customer; foreign and nonexistent payment IDs return the same not-found contract |
| Appointment payment accidentally activated | Plan 5 backend rejects `APPOINTMENT`; restored client compatibility functions throw locally and make no provider/network call |

## 8. Verification evidence matrix

Plan 5 cannot be certified solely because code compiles. Required merge evidence includes:

- Flyway V1-current clean migration including V16 constraints/indexes;
- backend secret/privacy source scans;
- API tests proving no client Customer/amount authority and ownership-safe reads;
- durable multi-key idempotency and single-Payment concurrency evidence;
- exact money/provider identity mismatch tests;
- bad/missing webhook signature/version/delivery identity tests;
- duplicate/out-of-order provider-attempt tests;
- transport UNKNOWN/reconciliation tests;
- capture/expiry/cancellation and late-capture refund tests;
- refund PENDING/ONHOLD/FAILED/CANCELLED/SUCCESS/ambiguous execution tests;
- Customer typecheck/tests proving callback is not success authority and only safe recovery IDs persist;
- Merchant regression proving unpaid ONLINE_PAYMENT cannot be accepted and PAY_ON_FULFILMENT remains unchanged;
- exact-head GitHub CI after the approved recovery implementation is moved to draft PR #38;
- manual Cashfree sandbox Create Order/native checkout/webhook/reconciliation/refund exercise before production enablement.

## 9. Production configuration / operational gate

Expected server-only configuration:

```text
CASHFREE_ENABLED=true
CASHFREE_CLIENT_ID=<secret-ish merchant credential>
CASHFREE_CLIENT_SECRET=<secret>
CASHFREE_API_VERSION=2026-01-01
CASHFREE_WEBHOOK_VERSION=2026-01-01
CASHFREE_BASE_URL=<approved HTTPS environment>
CASHFREE_RETURN_URL=<approved app/web return>
CASHFREE_NOTIFY_URL=<public HTTPS webhook URL>
```

CI and ordinary unit/integration tests must use fake/stub provider transport and must never call live Cashfree. Production must fail closed or keep online payment unavailable when required provider configuration is invalid or missing.

## 10. Known evidence still required outside source

The following remain production blockers rather than code TODOs:

- executed/approved Cashfree commercial/privacy terms and processor evidence;
- Cashfree account region/subprocessor/retention and breach-cooperation evidence;
- production/sandbox credential management evidence and rotation owner;
- public webhook URL/TLS and Cashfree dashboard webhook-version configuration evidence;
- sandbox payment/refund reconciliation screenshots/log IDs with no sensitive payloads;
- final legal retention schedule for payment/order tax, consumer and dispute records.
