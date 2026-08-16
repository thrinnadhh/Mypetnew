# Appointment Provider Confirmation Flow

## Purpose

Grooming and veterinary appointments use an explicit provider decision before the Customer sees an appointment as confirmed. This mirrors the operational acceptance step used by marketplace order systems: a Customer may request a valid slot, but the provider remains authoritative for accepting or declining the request.

## Canonical state model

```text
AVAILABLE SLOT
    |
    v
HOLD
Customer selected the slot. Temporary concurrency-safe reservation.
    |
    | Customer submits booking request
    v
BOOKED
Internal persisted name retained for V17 compatibility.
Customer meaning: WAITING FOR PROVIDER.
Merchant meaning: NEW BOOKING REQUEST.
    |
    +---------------- Provider accepts ----------------+
    |                                                  |
    v                                                  v
CONFIRMED                                           REJECTED
Provider accepted.                                 Provider declined.
    |
    v
CHECKED_IN -> IN_SERVICE -> COMPLETED
```

`BOOKED` MUST NOT be presented to the Customer as `CONFIRMED`. Customer clients map it to `PENDING_PROVIDER` / "Waiting for provider". `CONFIRMED` is produced only by an authenticated Merchant transition for an authorized outlet.

## Customer flow

1. Customer discovers a serviceable grooming or veterinary provider.
2. Customer chooses a service, pet, and live available slot.
3. Backend creates `HOLD` using Customer identity, pet ownership, server price and an idempotency key.
4. Customer reviews the request and submits it.
5. Backend changes `HOLD -> BOOKED`.
6. Customer UI shows **Waiting for provider confirmation**.
7. If provider accepts, the next Customer refresh/detail read shows **Confirmed**.
8. If provider declines, the Customer sees **Provider declined** and the slot is no longer occupied by that request.
9. Customer may cancel a `HOLD`, pending `BOOKED`, or `CONFIRMED` appointment under the current cancellation rules.

## Merchant flow

1. Authenticated Merchant opens **Booking requests**.
2. `GET /api/v1/merchant/appointments?status=BOOKED` returns only requests for outlet IDs authorized in the server-owned Merchant principal.
3. Merchant chooses one of:
   - **Accept booking** -> `POST /api/v1/merchant/appointments/{appointmentId}/status` with `CONFIRMED`.
   - **Reject** -> the same endpoint with `REJECTED`.
4. The pending request disappears from the inbox after a successful canonical transition.
5. Stale/raced decisions fail closed and the Merchant client reloads server state.

The Merchant inbox response intentionally excludes Customer account identity and contact data. It exposes only the booking facts needed for the provider decision: outlet, service, slot, pet name, schedule, fee, notes and state.

## Concurrency and ownership

- `HOLD`, `BOOKED`, `CONFIRMED`, `CHECKED_IN`, and `IN_SERVICE` occupy the canonical slot.
- A second Customer cannot hold the same active slot.
- Merchant transitions require the `MERCHANT` role and authorized outlet scope.
- A Merchant cannot list or transition another outlet's appointment.
- Customer appointment reads/cancellations remain Customer-owned.

## Payment scope

This flow does **not** silently enable appointment online payment. Current appointments remain `PAY_AT_PROVIDER`; product Cashfree payment remains a separate `PRODUCT_ORDER` contract. Appointment online payment requires its own payment/refund state machine and must not be enabled by bypassing the provider-confirmation rules.

When appointment online payment is implemented later, provider acceptance must remain an explicit state transition and the payment lifecycle must define rejection, payment timeout, late capture, cancellation and refund behavior before production enablement.
