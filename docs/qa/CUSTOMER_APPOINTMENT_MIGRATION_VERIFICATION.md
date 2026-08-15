# Customer Appointment Migration Verification

This document records the repository-level verification scope for the MyPet-style grooming and veterinary appointment migration into MyPetNew.

## Canonical boundaries

- MyPetNew remains the authoritative backend and security architecture.
- Customer identity is derived from the authenticated principal; appointment APIs do not accept a client-authored customer ID.
- Pet ownership is verified server-side before a hold is created.
- Service price is snapshotted from the server-owned service offering; the Customer UI display amount is not authoritative.
- Appointment holds use an `Idempotency-Key` and a request fingerprint.
- Slot exclusivity is enforced transactionally: the JDBC hold path locks the canonical `service_slot` row, expires stale holds for that slot, re-checks occupying appointment states after lock acquisition, and only then inserts the new hold. The schema retains an ordinary slot/status index rather than claiming a PostgreSQL partial uniqueness constraint that is not present.
- Grooming and veterinary discovery use canonical public service and availability APIs rather than static production catalogues.
- Availability API failures are surfaced to the Customer retry/error state; only a successful empty availability response is rendered as "no slots".
- A deterministic Customer retry replays the same appointment hold while it remains active. If that key resolves to a terminal `CANCELLED`, `HOLD_EXPIRED`, or `REJECTED` appointment, the client creates one fresh attempt key so a still-future slot can legitimately be rebooked.
- Appointment confirmation is `PAY_AT_PROVIDER`; appointment flows do not create a Cashfree session.
- Product-order Cashfree support remains separate and retains its existing sandbox/live-certification boundaries.
- Patchable Customer transitive findings are pinned to `brace-expansion` 1.1.18 and `nanoid` 3.3.18.
- Customer dependency validation must reject Critical and unexpected High advisories while allowing only the same two documented, currently unpatched Expo/Metro `image-size` build-tool advisories already permitted by the Merchant dependency guard.

## Required merge gates

The candidate must not merge until all of the following are true on the exact final PR head SHA:

1. Customer dependency guard, typecheck, lint, and Jest suite succeed.
2. Backend verification succeeds, including Kotlin warning-as-error compilation and appointment API/domain tests.
3. Merchant regression validation succeeds.
4. A semantic review verifies ownership, authorization, idempotency, slot concurrency, server-authoritative price, DTO mapping, serviceability, loading/error/offline behavior, and absence of legacy appointment endpoints.
5. A second independent semantic review is completed on the unchanged final SHA.

## Exact-head rerun note

The final validation must execute from a normal repository-authored commit after any bot-authored fixture or lockfile migration so GitHub Actions actually runs the Customer, Merchant, and backend jobs on the final candidate rather than leaving them in an action-required state.

Physical Android behavior, real Cashfree transactions, external push delivery, and production-provider credentials are separate external evidence gates and must not be claimed from repository CI alone.
