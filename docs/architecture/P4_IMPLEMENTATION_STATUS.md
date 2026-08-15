# P4 Implementation Gate Status

Branch: `feat/customer-p4-captain-delivery`
Base: `main` at `489c2c131c4ab03219f0dcf200888a4f287ba0a0`

## Implemented

- Customer saved-address Captain-delivery checkout with server PIN serviceability.
- Canonical `POST /api/v1/customer/quotes/delivery` and unchanged `POST /api/v1/customer/orders` order-creation boundary.
- `MYPET_CAPTAIN_DELIVERY` uses the existing ProductOrder lifecycle; no duplicate order aggregate exists.
- Merchant-owned outlet dispatch origin with fail-closed delivery when it is not configured.
- READY_FOR_PICKUP starts/reuses one durable dispatch job; orphan READY orders are recovered after restart.
- CAPTAIN OTP/session authority resolves a pre-existing ACTIVE CAPTAIN account server-side.
- Captain eligibility: admin approval + online + fresh ephemeral location + not busy + radius ranking.
- Redis GEO/freshness contains ephemeral coordinates only; PostgreSQL retains dispatch truth and last-location timestamp metadata, not coordinate history.
- Transactional Captain offer/reject/accept flow with owner binding and replay-safe acceptance after a lost HTTP response.
- Empty GEO searches do not consume the actual Captain-offer attempt budget.
- Only the assigned Captain can advance delivery `READY_FOR_PICKUP -> PICKED_UP -> DELIVERED`; Merchant cannot spoof those transitions.
- Customer Orders list/detail accept only the two canonical fulfilment modes; delivery detail consumes the Customer-safe tracking projection.
- Pending Captain offers expose no Customer address/contact; fulfilment address is disclosed only after successful assignment.
- Live Captain location is disclosed to the owning Customer only while assignment is active and is removed from the tracking projection after terminal delivery.
- VIEW_ONLY medicine remains rejected from delivery quote/order paths.
- Delivery fee and ETA are server-owned configuration. Plan 4 does not invent a distance-pricing rule or allow the client to author price/ETA.
- Account deletion is blocked before any erasure while a Captain delivery is active. Once delivery is terminal, the delivery-address snapshot is redacted while transaction/order truth is retained.
- No Customer precise-location permission or Customer coordinates were added.

## Verification coverage

Backend/domain/API tests cover delivery quote persistence, Customer address/order ownership, serviceability, medicine exclusion, dispatch eligibility, deterministic ranking, reject/timeout retry, foreign Captain offer access, replay-safe acceptance, empty-candidate recovery, canonical Captain pickup/delivery authority, Captain auth/refresh authority, Flyway V15 and delivery identifier erasure.

Customer tests cover delivery quote/body/auth, generic canonical order creation, Orders-list/detail fulfilment whitelists and Customer tracking. Merchant CI remains a mandatory regression gate even though the current Merchant client has no operational order screen to migrate.

## Merge gate

Do not merge until the exact final PR-head SHA passes:

- backend `ci`
- `validate-restored-customer`
- `validate-merchant`
- final adversarial semantic/privacy/concurrency review with zero unresolved Critical/High defects
- zero unresolved review threads

Any code or documentation commit after a green run resets the exact-head gate.
