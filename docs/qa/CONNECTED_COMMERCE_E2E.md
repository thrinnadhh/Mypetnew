# Connected Commerce End-to-End Certification

## Objective

This certification closes the gap between the existing H2 walking-skeleton tests and the separate Captain delivery API tests. It executes one canonical commerce transaction through Customer, Merchant, Captain and Admin HTTP boundaries while the application uses real PostgreSQL 17/PostGIS, Flyway schema history, Spring Security/session validation, production JDBC persistence and Redis-backed Captain presence.

## Certified journey

1. Seed only canonical role identities required to enter otherwise non-public Merchant, Captain and Admin authority paths.
2. Merchant requests and verifies OTP against the real Merchant auth controller and server-owned Merchant identity.
3. Merchant submits a PRODUCT_STORE outlet through HTTP.
4. Admin approves that outlet through the provider-review HTTP boundary; audit context and idempotency are required.
5. Merchant configures dispatch origin, creates one catalog listing and receives stock through Merchant HTTP APIs.
6. Captain requests/verifies OTP, completes onboarding through Captain APIs, is approved by Admin, and publishes online location to the Redis-backed geo index.
7. Customer requests/verifies OTP and creates a saved delivery address through Customer APIs.
8. Customer obtains a canonical Captain-delivery quote and checks out one order.
9. The identical checkout command is replayed and must return the same order without duplicate reservation.
10. Merchant moves the order through ACCEPTED, PREPARING and READY_FOR_PICKUP. Replaying READY_FOR_PICKUP must not create a second dispatch job.
11. Captain receives and accepts the durable dispatch offer.
12. Customer tracking exposes the assigned Captain and customer delivery PIN, but not the Merchant pickup PIN.
13. The authorized Merchant reads the pickup handoff projection. The pickup PIN is available only while the assigned Captain is waiting for pickup; Customer access is forbidden.
14. Captain proves pickup through the Captain HTTP boundary. Identical replay is safe and the Merchant pickup PIN is immediately redacted.
15. Captain publishes a new Redis location and Customer tracking projects the fresh location while out for delivery.
16. Captain proves delivery with the Customer delivery PIN. Identical replay is safe.
17. Customer tracking finishes in DELIVERED and redacts proof/location data that is no longer needed.
18. PostgreSQL is checked for one canonical order, one dispatch job, one fulfilled reservation, correct inventory balance and the provider-approval audit record.

## Pickup handoff repair

The previous automated Captain tests obtained `DispatchJob.pickupPin` directly from a domain-service object. No HTTP projection exposed that proof to the Merchant, so a real actor-level flow could not complete without bypassing the application boundary.

`GET /api/v1/merchant/orders/{orderId}/delivery-handoff` closes that gap with these constraints:

- the caller must be an authenticated Merchant authorized for the order outlet;
- current `ORDER_FULFIL` permission is revalidated from PostgreSQL;
- the order must be `MYPET_CAPTAIN_DELIVERY` and have a durable dispatch job;
- the pickup PIN is returned only while the job is `ASSIGNED` to a Captain;
- before assignment and after pickup the pickup PIN is omitted;
- Customer, Captain and public routes do not receive this Merchant proof secret.

## Infrastructure

The dedicated `connectedE2eTest` task uses:

- `PostgresTestDatabase` with PostgreSQL 17/PostGIS;
- the repository's complete Flyway migration chain before Spring starts;
- Spring profile `local-isolated`, which keeps production JDBC business/session persistence active while providing deterministic in-memory OTP delivery for CI;
- a disposable Redis 7 container for Captain GEO presence/location;
- Cashfree disabled so the journey uses the supported `PAY_ON_FULFILMENT` path;
- outbound notification delivery disabled while durable notification records remain PostgreSQL-backed.

## Anti-cheat boundary

The E2E class may seed only role identities/sessions that have no public bootstrap endpoint. It must not directly insert or update product orders, provider outlets, catalog listings, inventory balances/reservations or dispatch jobs. All business state transitions occur through authenticated HTTP APIs.

The test may query PostgreSQL after the journey to certify canonical durable state.

## Truth boundaries

This certification **does not certify physical Android UI**, camera/barcode hardware, background OS lifecycle behavior, TalkBack, native deep-link launch, or physical-device GPS behavior.

It **does not certify external Cashfree or FCM delivery**. Cashfree is deliberately disabled for this pay-on-fulfilment transaction and outbound FCM delivery is disabled; those providers retain their separate sandbox/runtime certifications.

It also does not mutate or certify the PetShop staging deployment. The database and Redis used here are disposable CI infrastructure.
