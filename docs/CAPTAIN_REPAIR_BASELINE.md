# Captain Repair Baseline & Contract Reconciliation

## 1. Overview & Commit Lineage

- **Target Repair Branch:** `fix/captain-production-repair`
- **Current Main SHA (Base):** `2e8bfd3592ab342982b125c7e450986025661d8f` (`origin/main` at PR #104 / M2 catalog lifecycle completion)
- **Original Captain Commit SHA:** `e54200f7986c15e5747a892c2706672e643b3c33` (`feat(captain-app): implement complete Captain mobile app with auth, onboarding, dispatch, and e2e tests`)
- **Stale Branch:** `fix/p16-staging-runtime-hardening`
- **Merge Base SHA:** `f4bcc64cc42942fe15bf4c8fabdc54560f8d35b7`

---

## 2. Change Isolation & Scope Accounting

The stale branch `fix/p16-staging-runtime-hardening` diverged from main at `f4bcc64` and accumulated five commits. Only the Captain application files from commit `e54200f` were ported. All unrelated commits were intentionally excluded to preserve repository truth and protect active merchant/customer baselines.

### 2.1 Stale Commits Accounting

| Commit SHA | Commit Summary | Scope | Action | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `298f407` | `chore: add project architecture rules, design tokens, and workspace configs` | `.agents/`, `.claude/`, `.cursorrules`, `AGENTS.md`, etc. | **REJECTED** | Unrelated multi-agent workspace dump; not required for Captain mobile app runtime. |
| `6cdba9f` | `feat(backend): configure CORS for web development and exposed headers` | `backend/.../SecurityConfiguration.kt` | **REJECTED** | Uncontained wildcard CORS modifications across all routes; backend already has production-safe CORS for approved web origins. |
| `4337d3e` | `fix(customer-app): update wallet screen layout and balance display` | `apps/customer-app/src/app/wallet/index.tsx` | **REJECTED** | Unrelated customer wallet visual layout changes; out of scope for Captain repair. |
| `64ba26a` | `feat(merchant-app): implement tabs, inventory, orders, POS, and loyalty workflows` | `apps/merchant-app/*` | **REJECTED** | Severe conflict with certified Merchant M0, M1, and M2 sprint work merged to `main` in PRs #99, #101, #103, #104. |
| `e54200f` | `feat(captain-app): implement complete Captain mobile app...` | `apps/captain-app/*` (96 files) | **RETAINED** | Complete standalone Captain React Native / Expo application codebase. |

---

## 3. Retained Captain Files (96 Files)

All files under `apps/captain-app/` were ported cleanly without carrying over dirty merge artifacts:

### 3.1 App Configuration & Environment (11 files)
- `apps/captain-app/.env.example`
- `apps/captain-app/.gitignore`
- `apps/captain-app/app.json`
- `apps/captain-app/eslint.config.js`
- `apps/captain-app/expo-env.d.ts`
- `apps/captain-app/jest.config.js`
- `apps/captain-app/jest.setup.js`
- `apps/captain-app/package.json`
- `apps/captain-app/package-lock.json`
- `apps/captain-app/test-flow.sh`
- `apps/captain-app/tsconfig.json`

### 3.2 Core API Client Layer (10 files)
- `apps/captain-app/src/api/client.ts`
- `apps/captain-app/src/api/auth.ts`
- `apps/captain-app/src/api/availability.ts`
- `apps/captain-app/src/api/captain.ts`
- `apps/captain-app/src/api/deliveries.ts`
- `apps/captain-app/src/api/dispatch.ts`
- `apps/captain-app/src/api/earnings.ts`
- `apps/captain-app/src/api/notifications.ts`
- `apps/captain-app/src/api/onboarding.ts`
- `apps/captain-app/src/api/support.ts`

### 3.3 Auth & Session Management (3 files)
- `apps/captain-app/src/auth/context.tsx`
- `apps/captain-app/src/auth/session.ts`
- `apps/captain-app/src/auth/types.ts`

### 3.4 Design System & Tokens (1 file)
- `apps/captain-app/src/design/tokens.ts`

### 3.5 Reusable UI Components (20 files)
- `apps/captain-app/src/components/ActiveDeliveryCard.tsx`
- `apps/captain-app/src/components/AddressCard.tsx`
- `apps/captain-app/src/components/Button.tsx`
- `apps/captain-app/src/components/CaptainHeader.tsx`
- `apps/captain-app/src/components/CaptainStatusCard.tsx`
- `apps/captain-app/src/components/Card.tsx`
- `apps/captain-app/src/components/ContactButton.tsx`
- `apps/captain-app/src/components/DeliveryOfferCard.tsx`
- `apps/captain-app/src/components/DeliveryTimeline.tsx`
- `apps/captain-app/src/components/EmptyState.tsx`
- `apps/captain-app/src/components/Input.tsx`
- `apps/captain-app/src/components/LocationStatusBanner.tsx`
- `apps/captain-app/src/components/MoneyAmount.tsx`
- `apps/captain-app/src/components/NavigationButton.tsx`
- `apps/captain-app/src/components/OfferCountdown.tsx`
- `apps/captain-app/src/components/OfflineBanner.tsx`
- `apps/captain-app/src/components/OnlineToggle.tsx`
- `apps/captain-app/src/components/ProofCodeInput.tsx`
- `apps/captain-app/src/components/RetryPanel.tsx`
- `apps/captain-app/src/components/StatusBadge.tsx`

### 3.6 Features & Domain Services (7 files)
- `apps/captain-app/src/features/delivery/delivery-context.tsx`
- `apps/captain-app/src/features/delivery/types.ts`
- `apps/captain-app/src/features/location/location-permissions.ts`
- `apps/captain-app/src/features/location/location-publisher.ts`
- `apps/captain-app/src/features/location/location-service.ts`
- `apps/captain-app/src/features/navigation/navigation-provider.ts`
- `apps/captain-app/src/features/navigation/phone-dialer.ts`

### 3.7 Routing & Navigation Screens (31 files)
- `apps/captain-app/src/app/_layout.tsx`
- `apps/captain-app/src/app/index.tsx`
- `apps/captain-app/src/app/(tabs)/_layout.tsx`
- `apps/captain-app/src/app/(tabs)/home.tsx`
- `apps/captain-app/src/app/(tabs)/deliveries.tsx`
- `apps/captain-app/src/app/(tabs)/earnings.tsx`
- `apps/captain-app/src/app/(tabs)/inbox.tsx`
- `apps/captain-app/src/app/(tabs)/profile.tsx`
- `apps/captain-app/src/app/auth/login.tsx`
- `apps/captain-app/src/app/auth/otp.tsx`
- `apps/captain-app/src/app/delivery/offer.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/index.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/pickup.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/pickup-proof.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/delivery-proof.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/completed.tsx`
- `apps/captain-app/src/app/delivery/[jobId]/customer.tsx`
- `apps/captain-app/src/app/onboarding/index.tsx`
- `apps/captain-app/src/app/onboarding/personal.tsx`
- `apps/captain-app/src/app/onboarding/identity.tsx`
- `apps/captain-app/src/app/onboarding/vehicle.tsx`
- `apps/captain-app/src/app/onboarding/bank.tsx`
- `apps/captain-app/src/app/onboarding/documents.tsx`
- `apps/captain-app/src/app/onboarding/consent.tsx`
- `apps/captain-app/src/app/onboarding/review.tsx`
- `apps/captain-app/src/app/onboarding/status.tsx`
- `apps/captain-app/src/app/permissions/location.tsx`
- `apps/captain-app/src/app/permissions/notifications.tsx`
- `apps/captain-app/src/app/settings/index.tsx`
- `apps/captain-app/src/app/support/index.tsx`
- `apps/captain-app/src/app/support/new.tsx`

### 3.8 Utilities (6 files)
- `apps/captain-app/src/utils/date.ts`
- `apps/captain-app/src/utils/errors.ts`
- `apps/captain-app/src/utils/idempotency.ts`
- `apps/captain-app/src/utils/money.ts`
- `apps/captain-app/src/utils/supabase.ts`
- `apps/captain-app/src/utils/validation.ts`

### 3.9 Test Suites (7 files)
- `apps/captain-app/src/__tests__/api/dispatch.test.ts`
- `apps/captain-app/src/__tests__/auth/session.test.ts`
- `apps/captain-app/src/__tests__/features/delivery-e2e.test.ts`
- `apps/captain-app/src/__tests__/features/location.test.ts`
- `apps/captain-app/src/__tests__/utils/date.test.ts`
- `apps/captain-app/src/__tests__/utils/idempotency.test.ts`
- `apps/captain-app/src/__tests__/utils/money.test.ts`

---

## 4. Contract Drift & Backend Reconciliation Analysis

### 4.1 Authentication & Session Contracts

| Endpoint | Method | Backend Status on Main | App Expectation | Alignment Status |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/otp/request` | `POST` | Implemented in `IdentityController.kt` | `{ mobile, purpose: 'LOGIN', deviceId }` | **ALIGNED** |
| `/api/v1/auth/captain/otp/verify` | `POST` | Implemented in `CaptainIdentityController.kt` | `{ challengeId, mobile, purpose: 'LOGIN', code }` (fixes `Role.CAPTAIN`) | **ALIGNED** |
| `/api/v1/auth/sessions/refresh` | `POST` | Implemented in `IdentityController.kt` | `{ refreshToken }` -> returns fresh access token preserving `Role.CAPTAIN` | **ALIGNED** |
| `/api/v1/auth/sessions/current` | `DELETE` | Implemented in `IdentityController.kt` | Header `Authorization: Bearer <token>` | **ALIGNED** |

### 4.2 Dispatch & Delivery Lifecycle Contracts

| Endpoint | Method | Backend Status on Main | App Expectation | Alignment Status |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/captain/availability` | `PUT` | Implemented in `CaptainDeliveryApiController.kt` | `{ online: boolean, latitude?: number, longitude?: number }` | **ALIGNED** |
| `/api/v1/captain/dispatch/offers` | `GET` | Implemented in `CaptainDeliveryApiController.kt` | Returns `List<CaptainOfferProjection>` (`offerId`, `jobId`, `expiresAt`) | **ALIGNED** (Enrichment metadata `outletName`, `distanceMeters`, `itemCount` optional) |
| `/api/v1/captain/dispatch/offers/{offerId}/respond` | `POST` | Implemented in `CaptainDeliveryApiController.kt` | `{ action: 'ACCEPT' \| 'REJECT' }` -> Returns `CaptainAssignmentProjection` | **ALIGNED** |
| `/api/v1/captain/dispatch/{jobId}/picked-up` | `POST` | Implemented in `CaptainDeliveryApiController.kt` | Header `Idempotency-Key` -> transitions job to `PICKED_UP` | **ALIGNED** |
| `/api/v1/captain/dispatch/{jobId}/delivered` | `POST` | Implemented in `CaptainDeliveryApiController.kt` | Header `Idempotency-Key` -> transitions job to `DELIVERED` | **ALIGNED** |
| `/api/v1/admin/captains/{captainId}/approve` | `POST` | Implemented in `CaptainApprovalApiController.kt` | Admin permission gated (`CAPTAIN_REVIEW`) | **ALIGNED** |

### 4.3 Missing Backend Endpoints / Fallback Handlers

The Captain application contains frontend modules for features that are not yet backed by dedicated Spring Boot controllers on `main`. The client code handles these via graceful fallbacks:

| Feature / Endpoint | App Handling / Fallback | Backend State on Main | Follow-up Need |
| :--- | :--- | :--- | :--- |
| `GET /api/v1/captain/me` | Client falls back to availability/state defaults | Not implemented (auth principal contains `actorId` and `Role.CAPTAIN`) | Implement `/api/v1/captain/me` profile query endpoint. |
| `GET /api/v1/captain/onboarding/draft`<br>`PUT /api/v1/captain/onboarding/draft`<br>`POST /api/v1/captain/onboarding/submit` | Client falls back to direct Supabase `captain_onboarding` table or in-memory state | Not implemented in Spring backend | Provide backend onboarding draft persistence or formalize Supabase private storage bridge. |
| `GET /api/v1/captain/dispatch/active` | Client tracks active job in React Context / local state | Not exposed via dedicated REST endpoint | Expose active job query for fast session restoration across app restarts. |
| `GET /api/v1/captain/deliveries/history` | Client returns empty history array gracefully | Not exposed via dedicated REST endpoint | Implement Captain completed order history projection. |
| `GET /api/v1/captain/earnings` | Client returns zeroed earnings state gracefully | Not implemented in backend | Implement Captain earnings and settlement calculations. |
| `GET /api/v1/captain/notifications`<br>`POST /api/v1/captain/notifications/{id}/read` | Client returns empty notifications array gracefully | Notification worker exists on backend, but client inbox API not exposed | Expose Captain inbox notification queries. |
| `POST /api/v1/captain/support/tickets` | Client simulates ticket creation with client ticket ID | Not implemented | Implement support ticket ingestion endpoint. |

---

## 5. Build & Test Baseline Verification

### 5.1 Captain Application (`apps/captain-app`)
- **Package Installation:** `npm ci` completed cleanly (1021 packages, 0 vulnerabilities).
- **TypeScript Typecheck:** `npm run typecheck` (`tsc --noEmit`) passed with **0 errors**.
- **Jest Test Suite:** `npm test` passed: **7 test suites, 26 tests passed (100%)**.
- **Lint Check:** `npm run lint` reported 9 React hook/JSX quote formatting warnings/errors (see Section 6).

### 5.2 Backend Service (`backend`)
- **Kotlin Compilation:** `./gradlew :backend:compileKotlin` completed with **BUILD SUCCESSFUL**.
- **Backend Test Suite:** `./gradlew :backend:test` completed with **BUILD SUCCESSFUL (all test suites and contract certifications passed)**.
- **Security & Privacy Scans:** `./scripts/privacy-security-scan.sh` and `./scripts/verify-merchant-operations.sh` passed.
- **Merchant Verification:** `bash ./scripts/verify-merchant.sh` passed (typecheck, lint, 5 test suites/49 tests, and Expo web export).

---

## 6. Known Remaining Issues & Follow-up Repair Plan

### 6.1 Remaining Lint Issues in Captain App (9 issues)
1. `src/app/(tabs)/deliveries.tsx:26:5` — `react-hooks/set-state-in-effect` (calling state update in `useEffect`)
2. `src/app/(tabs)/earnings.tsx:23:5` — `react-hooks/set-state-in-effect`
3. `src/app/(tabs)/earnings.tsx:49:47` — `react/no-unescaped-entities` (unescaped apostrophe)
4. `src/app/(tabs)/home.tsx:181:51` — `react/no-unescaped-entities`
5. `src/app/(tabs)/home.tsx:185:51` — `react/no-unescaped-entities`
6. `src/app/(tabs)/inbox.tsx:23:5` — `react-hooks/set-state-in-effect`
7. `src/app/_layout.tsx:17:5` — `react-hooks/set-state-in-effect`
8. `src/app/permissions/location.tsx:26:5` — `react-hooks/set-state-in-effect`
9. `src/features/delivery/delivery-context.tsx:173:7` — `react-hooks/set-state-in-effect`

### 6.2 Prioritized Follow-up Tasks (Next Sprints)
1. **P1 — Captain App Quality Sweep:** Resolve the 9 React hook/quote lint errors and add Expo export verification script for Captain app.
2. **P2 — Backend Active Dispatch Restoration:** Add `GET /api/v1/captain/dispatch/active` and `GET /api/v1/captain/me` endpoints in `CaptainDeliveryApiController.kt`.
3. **P3 — Proof Verification Hardening:** Align `pickup-proof` and `delivery-proof` verification tokens between client and backend.
