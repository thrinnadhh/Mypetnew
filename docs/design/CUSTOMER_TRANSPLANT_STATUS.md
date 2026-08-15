# Customer Frontend Transplant Status

Branch: `restore/customer-app-from-mypet`

## Scope guard

The transplant intentionally imports only `apps/customer-app` from `thrinnadhh/MyPet`.

Not imported:

- Merchant frontend
- Captain frontend
- Admin frontend
- old MyPet backend services

The only additional branch files outside the Customer app are Customer-specific validation/design evidence.

## Validation

Latest validation of the restored and Stitch-patched Customer app:

- `npm ci`: PASS
- TypeScript (`npm run typecheck`): PASS
- Expo lint (`npm run lint`): PASS
- Customer layout test including Stitch-guided pet management: PASS
- Jest: PARTIAL — 184 / 188 tests pass

The four failing tests are inherited cross-repository assertions that attempt to read old MyPet microservice source files which are not part of MyPetNew's Kotlin/Spring modular-monolith backend:

- old payment-service `PaymentController.kt`
- old order-service `RecurringOrderService.kt` (referenced by two assertions)
- old appointment-service `MedicalDocumentService.kt`

Those tests are deliberately retained as migration/compatibility signals rather than removed or weakened.

## Current compatibility blockers

1. `customer-pets.ts` calls `/api/v1/pets`; MyPetNew currently does not expose that route. The Stitch-guided My Pets surface therefore correctly reports the API failure in live mode until the backend contract is added/remapped.
2. Other inherited Customer services were written against the old MyPet service topology and require endpoint-by-endpoint compatibility auditing before this branch can be considered integration-ready.
3. The inherited npm dependency tree currently reports 14 high-severity advisories during `npm ci`; these need dependency/audit triage before production certification.

## Certification

**Frontend source transplant: PASS**

**Stitch missing-screen coverage: PASS for the identified Profile/My Pets gap**

**MyPetNew backend integration: NOT CERTIFIED**

**Production readiness: NOT CERTIFIED**
