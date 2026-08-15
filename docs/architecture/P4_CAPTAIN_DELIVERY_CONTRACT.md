# P4 — Canonical Captain Delivery Contract

Status: implementation contract

Starting main: `489c2c131c4ab03219f0dcf200888a4f287ba0a0`

## Authority

This slice implements Plan 4 of `CUSTOMER_PRODUCTION_10_PLAN_ROADMAP.md` while preserving `DECISIONS.md` D-009, D-012, D-013 and DD-005..DD-007.

## Invariants

- `ProductOrder` remains the sole product-order lifecycle. Dispatch never creates a second order aggregate.
- Delivery checkout uses `MYPET_CAPTAIN_DELIVERY`; store pickup remains `STORE_PICKUP`.
- `POST /api/v1/customer/orders` remains the only Customer product-order creation boundary.
- Customer identity comes only from the authenticated principal.
- Delivery serviceability is server-derived from the selected saved address PIN and the outlet's active service PIN set.
- A delivery quote snapshots the Customer-owned delivery address, server delivery fee, ETA and canonical listing prices.
- Merchants may transition a delivery order through `PLACED -> ACCEPTED -> PREPARING -> READY_FOR_PICKUP` only. Only the assigned Captain may transition delivery `READY_FOR_PICKUP -> PICKED_UP -> DELIVERED`.
- `PREPARING -> READY_FOR_PICKUP` starts at most one dispatch job per order.
- Captain eligibility requires an ACTIVE CAPTAIN identity, admin approval, online presence, a location timestamp within the freshness window, not busy, and GEO proximity.
- PostgreSQL owns durable dispatch job/offer/assignment truth. Redis holds only ephemeral Captain coordinates/freshness used for candidate ranking and Customer live-location projection.
- Pending Captain offers do not disclose Customer address/contact. The assigned Captain receives the delivery-address snapshot only after successful offer acceptance.
- Customer tracking returns a minimum Captain projection and only currently fresh location data.
- Medicine remains `VIEW_ONLY` and cannot enter delivery quote/order paths.

## Canonical APIs

### Customer

- `POST /api/v1/customer/quotes/delivery`
  - request: `{outletId,addressId,lines:[{listingId,quantity}]}`
  - response: canonical `Quote` with `fulfilmentMode=MYPET_CAPTAIN_DELIVERY`, server `deliveryFeePaise`, ETA and address snapshot.
- `POST /api/v1/customer/orders`
  - unchanged request: `{quoteId,cartSignature}` plus `Idempotency-Key`.
  - accepts either supported quote fulfilment mode; client cannot mutate fulfilment mode.
- `GET /api/v1/customer/orders/{orderId}/tracking`
  - ownership checked from authenticated Customer principal.
  - returns order status/flow step/payment state, dispatch status, minimal Captain projection, ETA and fresh Captain location if available.

### Merchant

- `PUT /api/v1/merchant/outlets/{outletId}/dispatch-origin`
  - configures server-owned outlet dispatch latitude/longitude after Merchant outlet authorization.
- Existing `POST /api/v1/merchant/orders/{orderId}/transitions`
  - on a delivery order, `PREPARING -> READY_FOR_PICKUP` creates/reuses one dispatch job.

### Captain

- `PUT /api/v1/captain/availability`
- `GET /api/v1/captain/dispatch/offers`
- `POST /api/v1/captain/dispatch/offers/{offerId}/respond`
- `POST /api/v1/captain/dispatch/{jobId}/picked-up`
- `POST /api/v1/captain/dispatch/{jobId}/delivered`

### Admin

- `POST /api/v1/admin/captains/{captainId}/approve` guarded by `CAPTAIN_REVIEW`.

## Data minimisation

P2's postal-address-only Customer policy remains unchanged. Plan 4 does not request Customer GPS permission or store Customer latitude/longitude. Captain coordinates are written to Redis with a short freshness TTL and are not persisted as coordinate history in PostgreSQL. PostgreSQL stores only Captain approval/online/busy state plus `last_location_at` metadata.

Outlet dispatch-origin coordinates are Merchant/provider operational data and remain absent from public outlet DTOs.

## Delivery pricing

The locked ₹10 Customer platform fee and ₹10 merchant commission remain unchanged and delivery charges remain separate. The Plan-4 delivery adapter takes its base delivery fee and ETA from server configuration (`mypet.delivery.base-fee-paise`, `mypet.delivery.eta-minutes`); the client never authors either value. Production launch configuration must set the intended delivery fee policy before release certification.

## Failure/recovery

- No eligible Captain leaves the durable job in retryable `SEARCHING` until the bounded attempt policy is exhausted.
- Offer expiry is persisted as `TIMED_OUT`; recovery retries the durable job.
- Redis lookup failure behaves as no ephemeral candidates; it cannot modify product-order truth.
- Offer acceptance is owner-bound and transactionally row-locked in PostgreSQL.
- Repeated READY handling reuses the existing job via unique `order_id`.

## Explicitly deferred

- Cashfree/online payment (Plan 5).
- Full loyalty rewards/reversal (Plan 6).
- Recurring orders (Plan 7).
- Grooming/vet runtime (Plan 8).
- A distance-routing provider or dynamic per-kilometre delivery-fee algorithm. Plan 4 keeps that policy server-configured rather than inventing an unapproved business rule.
