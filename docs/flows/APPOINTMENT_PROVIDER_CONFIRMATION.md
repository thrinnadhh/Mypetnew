# Appointment Provider Confirmation Flow

## Purpose

Grooming and veterinary appointments require an explicit provider decision before the Customer sees an appointment as confirmed. The Customer may choose **Pay Online** or **Pay at Provider**, but payment never substitutes for provider acceptance.

## Canonical state model

```text
AVAILABLE SLOT
    |
    v
HOLD
Customer selected the slot. Temporary concurrency-safe reservation.
    |
    +---------------- PAY_AT_PROVIDER ----------------+
    |                                                 |
    | Customer submits request                        |
    v                                                 |
BOOKED / PENDING_PROVIDER                             |
    ^                                                 |
    |                                                 |
    +---- ONLINE_PAYMENT: Cashfree CAPTURED ---------+
          backend verified, server price only

BOOKED / PENDING_PROVIDER
    |
    +---------------- Provider accepts ----------------+
    |                                                   |
    v                                                   v
CONFIRMED                                            REJECTED
Provider accepted.                                  Provider declined.
    |                                                   |
    |                                                   +-- captured online payment -> REFUND_PENDING -> REFUNDED
    v
CHECKED_IN -> IN_SERVICE -> COMPLETED
```

`BOOKED` is the persisted internal state for a valid Customer request waiting on the provider. It MUST NOT be presented to the Customer as `CONFIRMED`. `CONFIRMED` is produced only by an authenticated Merchant transition for an authorized outlet.

## Customer flow

1. Customer discovers a serviceable grooming or veterinary provider.
2. Customer chooses a service, pet, and live slot.
3. Customer chooses **Pay Online** or **Pay at Provider**.
4. Backend creates `HOLD` using authenticated Customer identity, server-verified pet ownership, server price, slot concurrency protection and an idempotency key.
5. **Pay at Provider:** Customer submits the request, producing `BOOKED / PENDING_PROVIDER`.
6. **Pay Online:** Customer initiates canonical Cashfree payment using only appointment ID + provider. Amount, currency and Customer identity are read by the backend. Verified `CAPTURED` moves `HOLD -> BOOKED / PENDING_PROVIDER`.
7. Customer UI shows **Waiting for provider confirmation**. A successful payment does not show the appointment as Confirmed.
8. Provider accepts -> `CONFIRMED`.
9. Provider rejects -> `REJECTED`. If an online payment was captured, the appointment payment moves through `REFUND_PENDING -> REFUNDED` (or explicit `REFUND_FAILED` requiring operational attention).
10. Customer cancellation after captured online payment also enters the refund workflow.
11. Failed/expired online payment never creates a provider-confirmed appointment.
12. A late Cashfree capture after the hold/appointment is terminal is not accepted as a booking; it is captured-and-refunded through the recovery workflow.

## Merchant flow

1. Authenticated Merchant opens **Booking requests**.
2. `GET /api/v1/merchant/appointments?status=BOOKED` returns only requests for outlet IDs authorized in the server-owned Merchant principal.
3. The Merchant sees the canonical payment mode/state, such as **Paid online** or **Pay at provider**.
4. Merchant chooses one of:
   - **Accept booking** -> `POST /api/v1/merchant/appointments/{appointmentId}/status` with `CONFIRMED`.
   - **Reject** -> the same endpoint with `REJECTED`.
5. For paid-online requests, rejection triggers the backend refund projection; the Merchant does not perform or fabricate a refund locally.
6. Stale/raced decisions fail closed and the Merchant client reloads canonical server state.

The Merchant inbox intentionally excludes Customer account identity and contact data. It exposes only the booking facts needed for the provider decision.

## Cashfree routing and authority

- Product orders keep the existing `PRODUCT_ORDER` payment contract and `mp_...` provider-order namespace.
- Appointment payments use `referenceType=APPOINTMENT` and deterministic `ma_...` provider-order references.
- The frontend never supplies appointment amount, currency, Customer ID, phone, email or payment status.
- Cashfree native callbacks are not payment truth; the app polls canonical backend payment state.
- Verified Cashfree webhooks are routed by provider-order namespace.
- Only backend-verified `CAPTURED` may advance an online appointment from `HOLD` to `BOOKED / PENDING_PROVIDER`.
- `CAPTURED` never directly produces `CONFIRMED`.

## Refund isolation

Appointment refunds are stored separately in `mypet.appointment_payment_refund`. This prevents the mature product-order refund worker from treating an appointment UUID as a product order ID while still reusing the Cashfree gateway abstraction.

Captured appointment payments require a refund when the appointment becomes terminal through provider rejection, Customer/provider cancellation, or a late capture after hold expiry. Recovery workers reconcile missing terminal refund projections and retry provider refund operations safely.

## Concurrency and ownership

- `HOLD`, `BOOKED`, `CONFIRMED`, `CHECKED_IN`, and `IN_SERVICE` occupy the canonical slot.
- A second Customer cannot hold the same active slot.
- Merchant transitions require the `MERCHANT` role and authorized outlet scope.
- A Merchant cannot list or transition another outlet's appointment.
- Customer appointment reads/cancellations and payment reads remain Customer-owned.
- Payment initiation is idempotent and bound to the appointment reference/fingerprint.

## Persistence compatibility

Released Flyway history is immutable. V17 remains unchanged. V18 adds canonical `payment_mode` / `payment_state` appointment projections and the dedicated appointment refund table while preserving legacy columns for migration compatibility.
