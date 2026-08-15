# Customer Appointment Migration Verification

This document records the repository-level verification scope for the MyPet-style grooming and veterinary appointment migration into MyPetNew.

## Canonical boundaries

- MyPetNew remains the authoritative backend and security architecture.
- Customer identity is derived from the authenticated principal; appointment APIs do not accept a client-authored customer ID.
- Pet ownership is verified server-side before a hold is created.
- Service price is snapshotted from the server-owned service offering; the Customer UI display amount is not authoritative.
- Appointment holds use an `Idempotency-Key` and a request fingerprint.
- PostgreSQL enforces one active occupying appointment per slot.
- Grooming and veterinary discovery use canonical public service and availability APIs rather than static production catalogues.
- Appointment confirmation is `PAY_AT_PROVIDER`; appointment flows do not create a Cashfree session.
- Product-order Cashfree support remains separate and retains its existing sandbox/live-certification boundaries.

## Required merge gates

The candidate must not merge until all of the following are true on the exact final PR head SHA:

1. Customer typecheck succeeds.
2. Customer lint succeeds.
3. Customer Jest suite succeeds.
4. Backend verification succeeds, including Kotlin warning-as-error compilation and appointment API/domain tests.
5. Merchant regression validation succeeds.
6. A semantic review verifies ownership, authorization, idempotency, slot concurrency, server-authoritative price, DTO mapping, loading/error/offline behavior, and absence of legacy appointment endpoints.
7. A second independent semantic review is completed on the unchanged final SHA.

## Exact-head rerun note

The final validation must execute from a normal repository-authored commit after any bot-authored fixture migration so GitHub Actions actually runs the Customer, Merchant, and backend jobs on the final candidate rather than leaving them in an action-required state.

Physical Android behavior, real Cashfree transactions, external push delivery, and production-provider credentials are separate external evidence gates and must not be claimed from repository CI alone.
