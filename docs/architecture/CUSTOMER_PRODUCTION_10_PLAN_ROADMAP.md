# MyPetNew Customer Production — 10-Plan Implementation Roadmap

Status: PLANNING ONLY — no application code implemented by this roadmap run.

Baseline: `main` @ `924ad77156e8a248c57c0e571cafba00f94daf99` (2026-08-14).

Authority: `docs/product/DECISIONS.md`, `docs/product/PRD.md`, current architecture contracts and current code.

External prerequisite: the dedicated India privacy/data-protection/security program must be merged to `main` with required CI green before implementation begins.

## Executive status

The Customer app is not production-ready. Sprint-1 Customer auth/session, public catalog, pickup quote, checkout/order creation, order-detail/cancel and merchant-scoped loyalty have canonical contracts or restored implementations, but the broad Orders list still depends on a restored legacy tracking route. Pets are missing on the backend. Delivery, Cashfree online payment, recurring-order runtime, support cases and medical-document backend capability are deferred. Current Customer source already contains screens/services for broader product areas; these must be treated as UI/reference surfaces until canonical MyPetNew backend contracts exist.

Locked rules that every plan must preserve: Spring Boot modular monolith is domain authority; Supabase is PostgreSQL/object-storage infrastructure only; one merchant/outlet per cart; products support store pickup and MyPet Captain delivery; Cashfree is behind a provider abstraction; loyalty is merchant-specific; recurring cadences are 7/15/25/30/35 days and create confirmation-required renewal proposals; medicines remain `VIEW_ONLY`; roles are CUSTOMER/MERCHANT/CAPTAIN/ADMIN only.

## Dependency graph

- `P1 -> P2 -> P3`
- `P2 + P3 -> P4`
- `P1 + P2 -> P5`
- `P1 + P5 -> P6`
- `P1 + P3 + P5 -> P7`
- `P2 + P3 + P5 + P6 -> P8`
- `P1..P8 -> P9 -> P10`

Implementation order follows risk/dependency, not screen convenience.

---

## Plan 1 — Certify the existing Customer transaction spine

**Objective:** finish and certify what already exists before adding new product scope.

**Current status:** PARTIAL. Canonical auth/session contract exists; public catalog is migrated; pickup quote and checkout use canonical `/api/v1/customer/*` contracts; order detail/cancel is canonical; merchant-scoped loyalty read is canonical. The broad Orders-tab list still uses a restored legacy tracking route because current persistence lacks a customer-list query primitive.

**Customer flow:** guest browse -> OTP -> single-outlet cart -> canonical pickup quote -> `PAY_ON_FULFILMENT` order -> customer order detail/history -> allowed cancel from `PLACED` -> merchant fulfilment -> loyalty projection.

**Frontend targets:** `home-screen.tsx`, `commerce-discovery-screen.tsx`, cart/checkout routes under `src/app`, `orders-screen.tsx`, order-detail route, auth context/services, `customer-checkout.ts`, `customer-orders.ts`, `customer-order-detail.ts`, `customer-history.ts`, `loyalty.ts`, notification destination surfaces.

**Backend targets:** `IdentityController`, `PublicCatalogController`, `CustomerOrderApiController`, Sprint-one quote/order controllers/services, order repository/query ports, loyalty projection, notification/device interfaces.

**Required API completion:**
- `GET /api/v1/customer/orders?page=0&pageSize=20&status=` -> `PageResponse<CustomerOrderSummaryResponse>` with `orderId,outlet{id,name},itemCount,grandTotalPaise,fulfilmentMode,paymentMethod,paymentStatus,status,placedAt,lastUpdatedAt`; ownership derives only from authenticated CUSTOMER principal; stable sort `placedAt DESC, orderId DESC`; bounded page size; no raw entities.
- Keep `GET /api/v1/customer/orders/{orderId}` and `POST /api/v1/customer/orders/{orderId}/cancel` as canonical detail/cancel boundaries.
- Preserve `POST /api/v1/customer/quotes/pickup` and `POST /api/v1/customer/orders` with `Idempotency-Key`.

**DB/query work:** add a customer-owned paged order-summary repository/query port over the existing canonical order tables; add index `(customer_id, placed_at desc, id)` if query plan proves necessary. No duplicate order table.

**Tests:** order-list ownership/foreign-ID, stable pagination, stale quote, duplicate checkout idempotency, concurrent cancel/merchant accept, inventory release, app restart/session refresh, zero old-MyPet endpoint usage in active Sprint-1 routes.

**E2E DoD:** real Customer can authenticate, browse, place one pickup/pay-on-fulfilment order, see it in Orders, open canonical detail, cancel only when valid, and observe merchant lifecycle without client-invented state. Physical FCM certification remains required where applicable.

**CI gates:** backend test/build; Customer npm clean install/typecheck/lint/Jest; Expo Doctor/fingerprint; current customer validation workflow; connected backend+Customer contract test.

**Readiness effect:** closes an explicitly documented integration blocker; do not assign a percentage until measured gates are rerun.

---

## Plan 2 — Customer profile, pets, addresses and serviceability foundation

**Objective:** establish canonical Customer-owned identity data needed by delivery, grooming/vet, recurring orders and support.

**Current status:** PARTIAL/MISSING. Profile UI exists; Customer pet backend is explicitly missing; delivery address/serviceability cannot be treated as canonical production capability yet.

**Frontend targets:** `profile-screen.tsx`, My Pets routes/components, address management/checkout address selector, auth-intent routing, loading/offline/error states.

**Backend modules:** new/complete Customer Profile, Pet and Address application/domain/persistence modules inside the modular monolith; reuse authenticated account ID, never client customerId.

**APIs:**
- `GET /api/v1/customer/profile` -> `CustomerProfileResponse{accountId,name,mobile,email?,profileCompletion}`.
- `PATCH /api/v1/customer/profile` -> `UpdateCustomerProfileRequest{name?,email?}`; mobile change is out unless separately verified.
- `GET /api/v1/customer/pets?page&pageSize` -> paged `CustomerPetResponse`.
- `POST /api/v1/customer/pets` and `PATCH/DELETE /api/v1/customer/pets/{petId}` with strict ownership.
- `GET /api/v1/customer/addresses`; `POST`; `PATCH/DELETE /{addressId}`; request includes label, recipient, phone, address lines, city, state, six-digit PIN, optional coordinates only if product flow needs them.
- `GET /api/v1/public/outlets/{outletId}/serviceability?pincode=517xxx&mode=DELIVERY` -> `ServiceabilityResponse{serviceable,fulfilmentMode,reasonCode}`. Store pickup must not be blocked by delivery PIN serviceability.

**Validation/errors:** Indian PIN six digits; normalized phone; pet IDs UUID; `RESOURCE_NOT_FOUND` for foreign/unknown owned objects; `VALIDATION_ERROR`; `OUTLET_NOT_SERVICEABLE`; bounded pagination.

**DB:** customer_profiles, customer_pets, customer_addresses if absent; ownership FKs; soft/archive semantics only where required by the merged privacy program; indexes by account/customer owner.

**Interactions:** Merchant never owns Customer profile data. Captain receives delivery-essential projection only in Plan 4. Vet/grooming consumes `petId` in Plan 8.

**Tests/DoD:** foreign pet/address access denied; guest cannot access owned resources; checkout can select a canonical address; serviceability response is server-derived; account/profile UI never guesses server truth.

---

## Plan 3 — Discovery, search, provider profiles, catalogue depth and favourites

**Objective:** turn the existing discovery-heavy UI into one canonical, scalable browse/search surface while enforcing medicine discovery-only behavior.

**Current status:** PARTIAL. Public outlets/catalog are canonical; existing screens include `home-screen.tsx`, `search-screen.tsx`, `provider-profile-screen.tsx`, `commerce-discovery-screen.tsx`, `appointment-discovery-screen.tsx`; favourites context exists. Broader search/favourites behavior must be verified against backend contracts.

**APIs:**
- Extend `GET /api/v1/public/outlets` with canonical optional filters `capability,pincode,q,page,pageSize`.
- Extend `GET /api/v1/public/catalog` with `outletId,category,q,commerceMode,page,pageSize,sort` and explicit server-supported sort enum.
- `GET /api/v1/public/catalog/{listingId}` returns explicit `PublicListingDetail`; medicine offerings expose `commerceMode=VIEW_ONLY` and never an add-to-cart action.
- `GET /api/v1/customer/favourites?page&pageSize`, `PUT /api/v1/customer/favourites/{listingId}`, `DELETE .../{listingId}`; idempotent add/remove; guest favourites may stay local and merge after login only through deterministic rules.

**Backend:** public query projections only; no search microservice required initially. PostgreSQL indexes/trigram/full-text only after measured query need. Keep merchant-owned listing identity.

**Tests:** same barcode/listing concepts cannot collapse across merchants; inactive/out-of-stock visibility rules; view-only medicine rejected by cart/order server paths; guest/auth favourite merge; stable pagination/search filters; empty/offline/retry UX.

**Legacy:** MyPet discovery/UI ideas are REFERENCE/ADAPT only. Do not import legacy global-product identity or microservice routes.

**DoD:** one consistent browse/search/provider model feeds Home, Search, Product Detail, Provider Profile and favourites without duplicated client-side product truth.

---

## Plan 4 — Captain delivery, address-aware quote and canonical live tracking

**Objective:** add the second locked fulfilment mode (`MYPET_CAPTAIN_DELIVERY`) without creating a parallel order lifecycle.

**Current status:** MISSING/DEFERRED in MyPetNew Sprint 1. Legacy MyPet contains a substantial dispatch service; LSE/NearBy contains assignment worker, Redis GEO and GPS/socket patterns.

**Customer flow:** cart -> choose address -> serviceability -> delivery quote -> order -> merchant accepts/prepares/READY_FOR_PICKUP -> dispatch -> captain assigned -> picked up -> delivered -> Customer tracking projection.

**APIs:**
- `POST /api/v1/customer/quotes/delivery` request `{outletId,addressId,lines[]}` -> canonical `QuoteResponse` including `fulfilmentMode=MYPET_CAPTAIN_DELIVERY`, `deliveryFeePaise`, ETA estimate and all existing pricing components; quote server-checks active outlet PIN serviceability.
- Existing `POST /api/v1/customer/orders` remains the only order-creation API, consuming quoteId/cartSignature; fulfilment mode comes from quote, not client mutation.
- `GET /api/v1/customer/orders/{orderId}/tracking` -> `CustomerOrderTrackingResponse{orderId,status,flowStep,paymentStatus,fulfilmentMode,captain?,eta?,deliveryStatus,lastLocation?}`. `captain` must be a minimum Customer-safe projection.
- Internal Captain/location APIs belong to Captain app/backend, not Customer.

**State model:** one ProductOrder state history; READY_FOR_PICKUP emits idempotent dispatch-start event exactly once; assignment has its own dispatch state; pickup/delivery proof transitions feed canonical order state.

**Geo/dispatch:** ADAPT LSE `backend/src/jobs/assignDelivery.js`, `backend/src/socket/gpsTracker.js`, delivery service patterns for Redis GEO, location TTL/freshness, optimistic/atomic assignment and realtime concepts. ADAPT MyPet `backend/dispatch-service/.../DispatchService.kt`, models, outbox/retry tests. REJECT legacy microservice topology; implement as MyPetNew modules.

**Eligibility:** captain approved + online + fresh location + not busy + within configured radius; deterministic ranking; exactly-one assignment under concurrent accepts; stale location excluded.

**DB/infra:** dispatch assignments/offers/history; captain location durable metadata plus Redis ephemeral GEO/freshness; outbox/idempotency record. Do not make Redis the source of order truth.

**Tests:** duplicate READY event; no captain; timeout/retry; stale/busy captain; last candidate; concurrent accept; restart/recovery; delivery OTP/proof if retained by authoritative future decision; customer tracking never invents ETA/status.

**DoD:** Customer can select Captain delivery, receive a server quote, place a normal order, and track one canonical lifecycle through delivered.

---

## Plan 5 — Provider-neutral online payments, Cashfree and refunds

**Objective:** activate online payment without allowing the Customer app to author amount, user identity or success state.

**Current status:** DEFERRED. `customer-payments.ts` already contains legacy-style Cashfree client helpers, including client-supplied `userId` and `amount`; these are not acceptable as the final canonical contract. Legacy MyPet has Cashfree gateway, hosted checkout, webhook lifecycle and tests that are useful references.

**Canonical APIs:**
- `POST /api/v1/customer/payments` request `{referenceType:PRODUCT_ORDER|APPOINTMENT, referenceId, provider:CASHFREE}` plus `Idempotency-Key`; server resolves authenticated Customer and canonical payable amount. Response `PaymentInitiationResponse{paymentId,provider,status,providerSession,expiresAt}`.
- `GET /api/v1/customer/payments/{paymentId}` and/or `/references/{type}/{id}` -> `PaymentStatusResponse{paymentId,referenceId,amountPaise,currency,status,updatedAt}`.
- Provider webhook remains server-only, signature-verified, replay-safe and idempotent.
- Refund creation should normally be an owning-domain command triggered by canonical cancellation/refund policy, not a Customer-authored arbitrary amount endpoint; Customer sees `RefundStatusResponse` from order/appointment detail.

**State:** `PENDING -> AUTHORIZED/CAPTURED|FAILED|EXPIRED`; webhook/reconciliation owns transitions. Order/appointment state must not become paid merely because browser/app returns from checkout.

**Reuse:** ADAPT MyPet `CashfreeGatewayService.kt`, `CashfreeWebhookLifecycleService.kt`, `PaymentService.kt`, `HostedCheckoutController.kt` and tests. REJECT service boundaries and any contract where client supplies authoritative amount/user.

**DB:** payments, payment_attempts, webhook_inbox/idempotency, refunds, immutable history; all money integer paise.

**Tests:** duplicate webhook, out-of-order webhook, wrong signature, client amount tampering, retry/reconciliation, cancelled checkout, process restart, refund idempotency.

**DoD:** online payment is optional beside allowed pay-on-fulfilment where product rules allow; Customer only observes server-reconciled state.

---

## Plan 6 — Full loyalty rewards, coupon stacking and reversal projection

**Objective:** evolve Sprint-1 `availableStars/rewards count` into the locked reward lifecycle without breaking merchant scoping.

**Current status:** PARTIAL. Merchant-specific balance read exists. Reward amounts/expiry/redemption/stacking and refund reversal projection are not part of current Sprint-1 response.

**APIs:**
- `GET /api/v1/customer/loyalty/{organizationId}` evolve via versioned DTO to include `availableStars`, ledger summary and `rewards:[{rewardId,valuePaise,status,issuedAt,expiresAt}]`.
- `GET /api/v1/customer/loyalty?page&pageSize` optional merchant-summary wallet projection; never aggregate stars into one global balance.
- Quote requests accept optional `loyaltyRewardId` and at most one `couponCode`; server validates merchant, expiry, spend, reservation and stacking.
- No direct client star mutation. Eligible delivered order/POS/grooming/vet completion events award exactly one star with source-event idempotency.

**State/data:** append-only loyalty ledger, reward issuance/consumption atomic at 10 stars, 90-day expiry, reward reservation/release at checkout, star-debt handling for reversed redeemed rewards.

**Tests:** duplicate source event, cross-merchant reward, refund reversal, 19-star rollover, reward expiry, reward+one coupon, two-coupon rejection, concurrent redemption.

**Interactions:** Merchant configures minimum eligible spend and reward value through Merchant/Admin contracts; Customer only consumes projections and eligible quote options.

**DoD:** Customer can understand merchant-specific progress, issued rewards and quote application without client-calculated eligibility.

---

## Plan 7 — Recurring orders as confirmation-required renewal proposals

**Objective:** implement locked recurring cadences without auto-order or auto-charge.

**Current status:** DEFERRED. Customer service `recurring-orders.ts` calls legacy `/api/v1/orders/subscriptions`; MyPet legacy has recurring models/repository/service/controller/migration/tests that can be adapted.

**Canonical APIs:**
- `GET /api/v1/customer/recurring-orders?page&pageSize`.
- `POST /api/v1/customer/recurring-orders` request `{sourceOrderId,cadenceDays:7|15|25|30|35,quantityMultiplier}` with idempotency; server derives merchant/outlet/items from owned eligible source order.
- `PATCH /api/v1/customer/recurring-orders/{id}` request `{action:PAUSE|RESUME|SKIP_NEXT|CANCEL|CHANGE, cadenceDays?,quantityMultiplier?}`.
- Scheduler creates `RenewalProposal` only: `GET /api/v1/customer/recurring-orders/{id}/proposals/{proposalId}` -> revalidated stock/price/provider/serviceability/pricing snapshot.
- `POST .../proposals/{proposalId}/confirm` with idempotency -> creates a fresh normal quote/order/payment path; never bypass Plan 4/5 rules.

**State:** recurring schedule ACTIVE/PAUSED/CANCELLED; proposal DUE/REVALIDATION_FAILED/AWAITING_CONFIRMATION/CONFIRMED/EXPIRED/SKIPPED.

**Reuse:** ADAPT MyPet recurring service/models/migration/tests; REJECT any behavior that automatically places COD or charges payment at due time.

**Tests:** scheduler duplicate tick, restart, price/stock changed, merchant unavailable, address no longer serviceable, expired reward/coupon, concurrent confirmation, cadence validation.

**DoD:** due recurrence produces a transparent proposal requiring explicit Customer confirmation and a new canonical transaction.

---

## Plan 8 — Grooming and veterinary appointments, with medicine still view-only

**Objective:** make existing appointment UI real through a separate appointment lifecycle while reusing common profile/pet/payment/loyalty foundations.

**Current status:** PARTIAL UI / backend expansion DEFERRED. `appointment-discovery-screen.tsx`, `appointments-screen.tsx`, `appointment-booking.ts` exist; authoritative decision requires grooming/vet appointment lifecycle separate from product orders. Medicines remain discovery only.

**APIs:**
- `GET /api/v1/public/services?capability=GROOMING|VETERINARY&outletId&page&pageSize`.
- `GET /api/v1/public/services/{serviceId}/availability?from&to` -> bounded slot DTOs.
- `POST /api/v1/customer/appointments` request `{outletId,serviceId,petId,slotId,notes?}` with idempotency -> `CustomerAppointmentResponse`.
- `GET /api/v1/customer/appointments?page&pageSize`; `GET /{id}`; `POST /{id}/cancel`.
- Appointment payment uses Plan 5 reference type; `PAID` remains payment state, not appointment state.
- Medical documents, only if product/legal scope requires them after the external security/privacy gate, use private storage reservation/finalization APIs returning purpose-bound signed access; never public bucket URLs.

**Lifecycle:** REQUESTED/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED/REJECTED/NO_SHOW (final enum to be approved with Merchant workflows); payment state separate. Only COMPLETED eligible event awards one merchant loyalty star via Plan 6.

**DB:** services, availability/slots, appointments, history; constraints preventing double-booking; pet/customer ownership references.

**Tests:** same-slot concurrency, foreign appointment, invalid pet ownership, cancellation race, provider status, payment success without booking completion, exactly-one loyalty star on completion.

**DoD:** grooming and vet booking are real canonical flows; pharmacy/medicine catalogue remains non-commerce everywhere.

---

## Plan 9 — Notifications, support, offline/error/accessibility/i18n and product reliability

**Objective:** harden every completed flow into a coherent production user experience.

**Current status:** PARTIAL. Notification inbox exists; device registration architecture is separately security-gated. Support-case backend is deferred. Customer source already contains `customer-cases.ts`, chat/content/communication helpers and i18n/design infrastructure.

**APIs/features:**
- Keep canonical `POST/DELETE /api/v1/devices/registrations` from merged security baseline.
- `GET /api/v1/customer/notifications?page&pageSize`, `POST /{id}/read`; payload routes only to canonical resource IDs and app reloads truth.
- `POST /api/v1/customer/support/cases` request `{referenceType,referenceId,category,description}` with idempotency; `GET /cases?page&pageSize`; `GET /cases/{id}`; append message/evidence APIs only if needed, with private signed storage.
- Define normalized retryable vs terminal error codes across all services; no feature-specific string guessing.

**UX quality:** loading/empty/offline/retry states on every screen; deterministic back navigation; safe areas/keyboard; touch targets; screen-reader labels; reduced-motion handling; no dead-end auth intents; Telugu/English groundwork only if translations are product-approved, otherwise preserve i18n architecture without fake partial localization.

**Reliability:** cache only non-authoritative read projections; queued writes only where semantics are explicitly idempotent; never fabricate successful order/payment/booking while offline. Add request correlation IDs and client crash breadcrumbs without sensitive payloads.

**Tests:** deep-link cold/warm start, deleted resource route, offline read/write, retry after timeout, app restart, duplicate notification, accessibility assertions, error-boundary behavior, support ownership.

**DoD:** every Plan 1-8 capability behaves intentionally under latency, denial, retry, restart, no-data and accessibility conditions.

---

## Plan 10 — Production configuration, full E2E and Play Store release certification

**Objective:** prove the app, not merely the source tree.

**Current status:** PARTIAL. Expo SDK 56/RN 0.85 baseline currently builds/fingerprints after PR #30; dependency/Hermes/security work is external prerequisite. Physical backend LAN and FCM/device evidence is still a release gate.

**Release work:** finalized environment matrix development/staging/production; production HTTPS-only API; app IDs/versionCode/versionName; icons/splash/adaptive icon; privacy-policy/terms/support URLs supplied by product/legal; crash/analytics production config; staged feature flags; EAS production AAB; Play Console internal/closed test; rollback/release runbook.

**Full E2E matrix:**
1. guest browse -> medicine view-only rejection;
2. OTP -> profile/pet/address;
3. pickup quote/order -> merchant fulfilment -> completion;
4. delivery quote/order -> dispatch/captain -> delivered;
5. online payment success/failure/reconciliation/refund;
6. order list/detail/cancel and history consistency;
7. loyalty award/reward/redemption/reversal;
8. recurring due -> revalidate -> Customer confirm -> new normal order;
9. grooming/vet slot -> appointment -> payment -> complete -> loyalty;
10. support case and notification deep-links;
11. foreign-resource/role/tenant negative tests as inherited security gates;
12. offline/retry/restart/concurrency tests;
13. physical Android FCM, deep link, logout zero-delivery;
14. physical Android performance/memory/battery smoke;
15. production Supabase/PostgreSQL migration + backup/restore/recovery evidence.

**CI/release gates:** all module tests; Customer typecheck/lint/Jest; backend build/tests; Flyway clean+upgrade test; Expo Doctor/install check/fingerprint; dependency/security gates; AAB generation; signed build install; smoke on at least representative Android versions; no Critical/High exploitable blocker; exact release commit tagged and evidence recorded.

**DoD:** release candidate has reproducible source/DB/build/device evidence. Repository-green alone is not production certification.

---

## API contract inventory by plan

| Plan | Canonical customer/public contracts |
|---|---|
| P1 | `/api/v1/auth/*`, `/api/v1/public/catalog|outlets`, `/api/v1/customer/quotes/pickup`, `/api/v1/customer/orders`, `/api/v1/customer/orders/{id}`, `/cancel`, new paged `/api/v1/customer/orders` read, merchant-scoped loyalty read |
| P2 | `/api/v1/customer/profile`, `/pets`, `/addresses`, public outlet serviceability |
| P3 | searchable/filterable public outlets/catalog, `/api/v1/customer/favourites` |
| P4 | `/api/v1/customer/quotes/delivery`, normal customer order creation, `/api/v1/customer/orders/{id}/tracking` |
| P5 | `/api/v1/customer/payments`, payment/reference status; server-only Cashfree webhook; refund projection |
| P6 | expanded merchant-scoped loyalty/rewards plus quote reward/coupon inputs |
| P7 | `/api/v1/customer/recurring-orders` and confirmation-required proposal APIs |
| P8 | public services/availability and `/api/v1/customer/appointments` |
| P9 | customer notifications/read state and `/api/v1/customer/support/cases` |
| P10 | no new business API by default; certification only unless gaps are proven |

## Legacy reuse matrix

| Source | Paths/pattern | Decision | Why |
|---|---|---|---|
| MyPet | `backend/payment-service/.../CashfreeGatewayService.kt`, `CashfreeWebhookLifecycleService.kt`, `PaymentService.kt`, hosted-checkout/tests | ADAPT | useful provider/webhook/idempotency logic; reject microservice topology and client-authored amount/user |
| MyPet | `backend/dispatch-service/.../DispatchService.kt`, models, outbox/retry | ADAPT | strong dispatch invariants; implement inside MyPetNew modular monolith and canonical order lifecycle |
| MyPet | `backend/order-service/.../RecurringOrderService.kt`, models/repository/migration/tests; Customer subscription UI | ADAPT | reuse scheduler/state/test ideas but enforce MyPetNew 7/15/25/30/35 proposal-only confirmation rule |
| MyPet | legacy Customer FCM hooks/tests | REFERENCE/ADAPT | use only if compatible with merged MyPetNew direct-FCM/device-registration architecture |
| LSE/NearBy | `backend/src/jobs/assignDelivery.js`, `backend/src/services/delivery.js` | ADAPT | candidate search/retry/locking ideas; rewrite idiomatically in Kotlin/Spring |
| LSE/NearBy | `backend/src/socket/gpsTracker.js` / socket realtime patterns | ADAPT | location freshness/realtime concepts; Customer receives canonical tracking projection, not raw socket authority |
| LSE/NearBy | legacy Node microservice topology/Kafka assumptions | REJECT | conflicts with locked MyPetNew modular-monolith architecture unless a later measured scale decision changes it |

## Cross-app interaction matrix

| Flow | Customer | Merchant | Captain | Admin |
|---|---|---|---|---|
| Catalog | browse/add eligible | owns listing/stock | none | moderation only when defined |
| Pickup order | quote/place/track/cancel | accept/prepare/ready/complete pickup | none | observe/support later |
| Delivery | address/quote/place/track | prepare/ready | offer/accept/pickup/deliver | dispatch/support observation |
| Payment | initiate/observe | settlement projection later | none | reconciliation/support |
| Loyalty | view/redeem | config + POS/eligible event source | none | controlled adjustment/audit only |
| Recurring | schedule/confirm proposal | normal resulting order only | normal delivery if selected | operational visibility later |
| Groom/Vet | discover/book/manage | provider schedules/fulfils | none | provider/support control |
| Support | create/read | scoped case participation | scoped delivery case participation | audited resolution |

## Hard E2E acceptance matrix

- No client-authored identity, price, fee, stock, order status, payment success, loyalty eligibility, serviceability or captain assignment.
- Every write with retry risk has idempotency semantics and mismatch handling.
- Every customer-owned resource rejects foreign ownership.
- Same merchant/outlet cart invariant survives guest -> auth merge and app restart.
- View-only medicine cannot enter cart/order/POS/recurring flow even with a modified client.
- Delivery dispatch starts exactly once from the authoritative ready transition.
- Payment webhook replay/out-of-order delivery cannot duplicate money/order transitions.
- Loyalty source events award/reverse exactly once.
- Recurring scheduler never auto-places or auto-charges.
- Appointment completion, not payment alone, triggers service loyalty eligibility.
- Offline/retry/restart never fabricates completed business state.

## Self-review change log

1. **P1 revised after inspecting T2E:** added canonical paged Customer order-list query as the first blocker because order detail is already canonical but Orders tab still relies on a restored legacy route.
2. **P2 moved before delivery/services:** pets and addresses are missing/shared prerequisites for vet/grooming, delivery and recurrence.
3. **P4 revised after legacy review:** reuse MyPet/LSE dispatch/GEO only as algorithms/invariants; explicitly reject their service topology and prevent Redis/socket state becoming order authority.
4. **P5 contract revised after inspecting current `customer-payments.ts`:** removed client-authoritative `userId` and `amount`; server derives both from authenticated principal/reference.
5. **P6 placed after payments:** reward reservation/reversal/refund behavior needs canonical financial outcomes.
6. **P7 placed after delivery/payment foundations:** renewal confirmation must create a normal revalidated transaction rather than a second fulfilment/payment path.
7. **P8 placed after profile/pets/payment/loyalty:** appointment implementation reuses those foundations and keeps booking state separate from payment state.
8. **P9 moved late:** notification/support/offline UX must route into final canonical resource contracts, otherwise it would encode transitional endpoints.
9. **P10 kept implementation-light:** release phase may fix proven blockers but must not become a catch-all feature-development sprint.

## Production blockers before implementation starts

1. India privacy/data-protection/security implementation must be merged to `main` with required CI green.
2. Current issue #31 dependency security work/Hermes production decision must be resolved by that program or explicitly tracked as a release blocker.
3. Current Sprint-1 active execution rules must be updated/approved before Plan 2+ product implementation begins; this roadmap is planning input, not authorization to bypass the current Sprint-1-only sprint document.

## Exact first implementation task after the security gate

**Branch:** `feat/customer-p1-order-list-certification`

**Scope:** Plan 1 only. Add the canonical paged Customer order-list query/DTO/repository port, migrate `orders-screen.tsx`/Customer list service away from the restored legacy tracking route, retain existing canonical order-detail/cancel contract, add ownership/pagination/contract/E2E tests, rerun full Customer/backend gates, perform two independent semantic reviews, and merge only on exact-head green CI. No delivery, Cashfree, recurring, grooming/vet or other Plan 2+ functionality in this PR.
