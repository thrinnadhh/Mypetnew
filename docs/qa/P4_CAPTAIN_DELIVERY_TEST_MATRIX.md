# P4 Captain Delivery — Adversarial Test Matrix

Required before merge:

- Customer cannot quote with another Customer's address ID.
- Delivery quote fails for inactive outlet, non-product outlet, non-serviceable PIN, missing dispatch origin, duplicate lines, VIEW_ONLY medicine, insufficient stock and invalid quantity.
- Delivery quote price/fee/ETA are server-owned and quote signature changes with delivery-address identity.
- Existing order creation accepts a valid Captain-delivery quote and rejects unsupported modes or delivery quotes without address snapshot.
- Pickup order behavior remains unchanged.
- Merchant cannot mark a Captain-delivery order PICKED_UP or DELIVERED.
- Captain cannot transition a store-pickup order.
- READY dispatch start is idempotent by order ID.
- Unapproved, offline, stale-location and busy Captains are excluded.
- Candidate ranking is deterministic by proximity then stable Captain ID.
- Rejected/timed-out Captain is not re-offered the same job.
- Offer may only be accepted by its Captain and only while pending/fresh.
- Concurrent offer acceptance resolves to exactly one durable assignment.
- No-Captain and Redis-unavailable cases do not mutate product-order truth.
- Assigned Captain alone may mark PICKED_UP/DELIVERED; transitions remain idempotent.
- Delivery completion releases Captain busy state.
- Customer tracking rejects foreign order IDs and returns no unassigned Captain/contact data.
- Pending Captain offer contains no Customer address/phone; accepted assignment may receive the quote's address snapshot.
- PostgreSQL schema contains no Captain latitude/longitude history columns.
- Redis Captain location freshness expires independently of durable dispatch assignment.
- Process restart/retry resumes SEARCHING/OFFERED jobs from PostgreSQL.
- Backend, Customer and Merchant exact-head CI must all be green.
