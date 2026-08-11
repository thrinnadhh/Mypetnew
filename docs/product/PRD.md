# MyPetNew Product Requirements Document

Status: **Implementation baseline**  
Version: **1.0**  
Date: **2026-08-11**  
Initial market: **Tirupati, Andhra Pradesh, India**  
Architecture: **Kotlin/Spring Boot modular monolith; PostgreSQL; separate Expo apps; Next.js Admin**

## 1. Purpose

MyPetNew connects pet owners with verified local pet-product stores, groomers, veterinary clinics/hospitals, and MyPet delivery captains. It also gives merchants a barcode-enabled catalog, inventory, POS, and merchant-specific loyalty system.

The system must create one shared operational truth across Customer, Merchant, Captain, and Admin applications. No client may infer missing order, payment, dispatch, appointment, loyalty, or refund state.

## 2. Product principles

1. **Transaction truth before screen breadth.** A business result is complete only when its server-owned state, audit trail, failure recovery, and cross-app projection are verified.
2. **Merchant ownership is explicit.** Listings, stock, prices, rewards, outlets, staff, orders, and bookings are tenant-scoped.
3. **Payment is not fulfilment.** Payment success never implies merchant acceptance, preparation, pickup, delivery, or appointment completion.
4. **One lifecycle, many projections.** Customer, Merchant, Captain, and Admin read role-safe views of the same canonical entities.
5. **Retry safely.** Network retries, duplicate scans, duplicate webhooks, worker replay, and concurrent actions must not duplicate money, stock, stars, rewards, or state transitions.
6. **Fail closed.** Missing authorization, stale quotes, invalid OTPs, unknown barcodes, view-only medicine, and ambiguous state must block the action.
7. **India-first correctness.** INR/paise, GST-ready snapshots, six-digit PIN codes, mobile OTP, local time presentation, and pharmacy boundaries are first-class.

## 3. Goals and success measures

### 3.1 Launch goals

- Let customers discover verified nearby merchants and services without signing in.
- Complete a single-merchant product transaction through pickup/pay-on-fulfilment, then online payment and captain delivery in later sprints.
- Let merchants onboard products with barcode scanning, manage stock, bill POS sales, and run loyalty.
- Let customers book grooming and veterinary appointments with atomic slot reservation.
- Let captains complete secure pickup and delivery using role-safe data and proof codes.
- Give Admin one control plane for approvals, transactions, failures, disputes, content, finance, audit, and city activation.
- Support recurring product reminders/orders at 7/15/25/30/35-day cadences with explicit customer confirmation.

### 3.2 Product KPIs

| KPI | Definition | Initial target after pilot stabilization |
|---|---|---|
| Checkout completion | confirmed product orders / checkout attempts excluding user validation errors | >= 85% |
| Stock integrity | orders with oversell or negative inventory | 0 |
| Payment reconciliation | terminal provider payments reconciled to one internal payment | 100% |
| Merchant response | accepted/rejected within configured SLA | >= 90% |
| Dispatch assignment | eligible deliveries assigned within configured search window | >= 90% |
| Delivery completion | picked-up orders reaching delivered without manual repair | >= 98% |
| Loyalty accuracy | eligible sources with exactly one correct ledger effect | 100% |
| Barcode onboarding | valid scans resolved or converted to merchant listing without duplicate | >= 99% |
| Appointment integrity | double-booked provider/staff slots | 0 |
| Crash-free sessions | production mobile sessions without crash | >= 99.5% |

Targets are observability goals, not permission to accept integrity failures.

## 4. Non-goals for Version 1

- live-animal sales, breeding, auctions, or transport;
- adoption/rescue marketplace;
- online purchase, subscription, or MyPet POS sale of medicines;
- global barcode/product master shared across merchants;
- multi-merchant cart or combined delivery;
- merchant self-delivery or third-party logistics;
- automatic recurring-order placement or automatic mandate charge;
- customer barcode scanning;
- a separate `SUPER_ADMIN` role;
- microservice deployment or premature service extraction;
- AI diagnosis or replacement of a licensed veterinarian.

## 5. Actors and authorization

### 5.1 Canonical roles

| Role | Primary capabilities | Prohibited boundaries |
|---|---|---|
| `CUSTOMER` | browse; manage profile/pets/addresses; cart; order; book; track; pay; use loyalty; recurring schedules; reviews/support | cannot mutate merchant, captain, admin, pricing, stock, or lifecycle authority |
| `MERCHANT` | organization/outlet; catalog; barcode; inventory; POS; orders; appointments; staff; loyalty config; coupons; earnings/support | cannot access another merchant; cannot grant arbitrary stars; cannot declare online payment success |
| `CAPTAIN` | onboarding/KYC; availability; location; accept/reject offer; pickup/delivery proof; earnings/support | cannot browse unrelated customer/order data; cannot self-assign or bypass proof |
| `ADMIN` | permission-scoped approvals, operations, support, finance, content, configuration, audit, city activation | cannot bypass audit, mutate money/history directly, or assume customer/merchant/captain identity |

### 5.2 Admin permission groups

`PROVIDER_REVIEW`, `CAPTAIN_REVIEW`, `CATALOG_MODERATION`, `ORDER_OPERATIONS`, `DISPATCH_OPERATIONS`, `PAYMENT_OPERATIONS`, `REFUND_APPROVER`, `SUPPORT_OPERATIONS`, `CONTENT_MANAGER`, `CITY_MANAGER`, `FINANCE_VIEW`, `AUDIT_VIEW`, and `ADMIN_ACCESS_MANAGER`.

High-risk actions require reason, audit event, and step-up authentication. Refund approval and admin-access changes support maker/checker policy before general availability.

## 6. Provider and outlet model

### 6.1 Organization

A Merchant account creates or joins a `MerchantOrganization`. An organization may have multiple `ProviderOutlet` records. Each outlet declares one or more verified capabilities:

- `PRODUCT_STORE`
- `GROOMING`
- `VETERINARY_CLINIC`
- `VETERINARY_HOSPITAL`
- `MEDICINE_CATALOG_VIEW_ONLY`

### 6.2 Verification

Merchant onboarding collects identity, business details, tax information when applicable, bank details, outlet address, service PIN codes, operating hours, and capability-specific evidence. Veterinary and medicine capabilities require explicit document fields and Admin approval before display.

Provider states:

`DRAFT -> SUBMITTED -> UNDER_REVIEW -> ACTIVE | REJECTED | SUSPENDED`

Only `ACTIVE` outlets are discoverable or transactable. Suspension immediately blocks new orders/bookings while preserving existing operational obligations and records.

### 6.3 Multi-tenancy requirements

- Every merchant-owned write includes organization and outlet ownership derived from authenticated authorization, never trusted request fields.
- Staff access is outlet-scoped and permission-scoped.
- Admin cross-tenant reads use explicit permission and emit audit events for sensitive views.
- Database queries and tests must prove isolation, including guessed UUIDs and batch endpoints.

## 7. Customer experience requirements

### 7.1 Discovery and guest access

`CUS-001` Guests can browse active merchants, product listings, categories, grooming services, veterinary providers, and view-only medicine listings.

`CUS-002` Discovery is filtered by active city/outlet configuration and, when delivery is selected, by the customer's six-digit PIN code.

`CUS-003` Search supports product/service/provider name, category, pet type, life stage, brand, and availability. Ranking must not expose suspended or inactive inventory.

`CUS-004` Product details show merchant/outlet identity, price, MRP when applicable, discount, GST-ready information, pack/variant, stock status, images, returnability, delivery/pickup eligibility, and medicine restrictions.

### 7.2 Authentication and account

`CUS-010` Browsing is guest-accessible. Checkout, booking, favorites sync, loyalty, recurring schedules, reviews, support cases, and order history require verified mobile OTP.

`CUS-011` OTP issuance and verification are rate-limited, purpose-bound, expiring, replay-safe, enumeration-resistant, and audited without logging OTP values.

`CUS-012` Guest cart merges into an authenticated cart only if merchant ownership is compatible; conflicts require explicit customer choice.

`CUS-013` Customers can maintain profile, pets, saved addresses, consent preferences, and account deletion/export requests.

### 7.3 Pet profiles

`CUS-020` A pet profile supports name, species, breed, sex, date/estimated age, weight, allergies, conditions, vaccination notes, and optional photo.

`CUS-021` Only minimum necessary pet/medical context is sent to a provider for a booked service. Access is time- and purpose-bound.

### 7.4 Cart and checkout

`ORD-001` A cart contains listings from exactly one merchant outlet. Cross-merchant add requires explicit replace/clear behavior.

`ORD-002` Cart quantity is validated against server stock and per-order limits. Client prices and totals are never accepted as authoritative.

`ORD-003` A server quote snapshots listing/variant, quantity, unit price, item discount, GST components, coupon, loyalty reward, ₹10 platform fee, delivery fee, fulfilment mode, and grand total. All money uses paise.

`ORD-004` Quotes expire and are bound to customer, outlet, cart signature, fulfilment mode, address/PIN code when delivery applies, and pricing-rule version.

`ORD-005` Store pickup bypasses delivery PIN-code validation but requires the outlet to be active and pickup-enabled.

`ORD-006` Sprint 1 supports pickup with `PAY_ON_FULFILMENT`. Later sprints add Cashfree online payment and captain-delivery COD subject to risk controls.

`ORD-007` Checkout uses an idempotency key and atomically creates the order, item snapshots, fee snapshot, inventory reservations, and coupon/reward reservations. Partial success is compensated or recovered by a worker.

`ORD-008` Order creation never awards a star. Eligible completion creates the loyalty effect.

### 7.5 Canonical product-order lifecycle

Business state:

`PLACED -> ACCEPTED -> PREPARING -> READY_FOR_PICKUP -> PICKED_UP -> DELIVERED`

Alternative terminal states:

- `PLACED -> REJECTED`
- eligible non-terminal state -> `CANCELLED`
- post-delivery reverse logistics -> `RETURN_REQUESTED -> RETURN_APPROVED|RETURN_REJECTED -> RETURNED`

Presentation labels such as “Arriving” are projections, not stored business states.

`ORD-020` Merchant transitions are server-validated; notes are required for reject/cancel and selected exception actions.

`ORD-021` Customer cancellation eligibility is server-computed from lifecycle, payment, fulfilment, timing, and merchant progress.

`ORD-022` Every transition appends status history with actor, role, note/reason, timestamp, and trace ID.

`ORD-023` Customer, Merchant, Captain, and Admin DTOs expose only role-appropriate fields from the same order and history.

### 7.6 Customer order detail contract

The canonical customer response contains:

- order ID and human order number;
- provider/outlet summary;
- immutable item snapshots;
- pricing and fee breakdown;
- payment method/status without secrets;
- business status, flow step, and status history;
- fulfilment mode;
- delivery address/contact when applicable;
- assigned captain summary and ETA when applicable;
- timestamps;
- cancellation/return/refund eligibility and summary;
- invoice availability;
- loyalty outcome after eligible completion.

Raw database entities must never be returned.

## 8. Merchant catalog, barcode, stock, and POS

### 8.1 Merchant-owned listings

`CAT-001` Listings belong to one merchant outlet. Separate outlets may list the same physical barcode independently.

`CAT-002` A listing supports type, name, category, pet type/life stage, brand, description, images, tax classification, GST rate, MRP, selling price, pack/weight, variant, SKU, normalized barcode, stock, low-stock threshold, expiry/batch fields when relevant, active state, and commerce mode.

`CAT-003` Selling price cannot exceed MRP where MRP applies; invalid manufacture/expiry ordering and expired batches are blocked.

`CAT-004` `MEDICINE` listings are forced to `VIEW_ONLY` in Version 1 and are rejected by cart, checkout, recurring, and POS transaction APIs.

### 8.2 Barcode onboarding

`BAR-001` The Merchant app requests camera permission contextually and supports manual entry when permission or hardware is unavailable.

`BAR-002` The server normalizes and validates GTIN-8/12/13/14 check digits. Merchant internal codes use an explicit `INTERNAL` type and configurable syntax.

`BAR-003` A normalized code is unique per merchant outlet and barcode type. Duplicate onboarding returns the existing listing rather than creating another.

`BAR-004` A barcode never supplies trusted price, tax, expiry, stock, customer, or staff identity. Those values come from authorized server records and confirmed merchant input.

`BAR-005` Unknown valid barcodes open a new merchant-listing draft; known barcodes open the authorized listing. Cross-merchant matches are not exposed as ownership or price suggestions in Version 1.

`BAR-006` Rapid repeated frames are debounced locally and deduplicated server-side by scan/action idempotency key.

### 8.3 Inventory

`INV-001` Inventory uses an append-only movement ledger with reason, quantity delta, resulting quantity, source type/reference, actor, outlet, and idempotency key.

`INV-002` Stock may change through receiving, POS sale, order reserve, order release, fulfilment, return, damage, expiry, count correction, or Admin-approved repair.

`INV-003` No operation may produce negative available stock. Reservation and POS races use database concurrency controls.

`INV-004` Stock count can scan each product, enter counted quantity, preview variance, and submit one idempotent adjustment batch.

### 8.4 POS

`POS-001` Merchant POS scans merchant-owned barcodes, resolves live price/stock, supports quantity changes, and computes totals server-side.

`POS-002` POS sale completion atomically writes sale/items, inventory movements, payment declaration (`CASH`, `EXTERNAL_UPI`, `CARD_TERMINAL`, or approved type), and eligible loyalty source.

`POS-003` POS is not a payment gateway. External UPI/card declarations are merchant attestations and must never be represented as Cashfree-captured payments.

`POS-004` Customer association uses an authenticated customer QR/challenge or OTP-based consent flow. Plain mobile-number entry cannot access or mutate loyalty.

`POS-005` Receipt contains merchant, outlet, GST-ready breakdown, items, payment declaration, loyalty result, and immutable sale reference.

## 9. Loyalty and rewards

`LOY-001` Loyalty balance is scoped to customer + merchant organization, with source outlet retained for audit.

`LOY-002` Eligible sources are the five events in Decision D-014. Each source reference can affect the ledger once.

`LOY-003` One merchant-verified onboarding star is allowed per customer/merchant relationship. Both authenticated parties must confirm a short-lived challenge.

`LOY-004` A transaction earns one star only after eligible completion and minimum spend. Default minimum is ₹100; merchant changes apply prospectively.

`LOY-005` Ten available stars are atomically consumed into one flat-value merchant reward. Extra stars remain.

`LOY-006` A reward belongs to the issuing merchant, expires after 90 days, and is single-use.

`LOY-007` Checkout may stack at most one valid normal coupon and one valid loyalty reward from the same merchant. Pricing revalidates minimum spend and exclusions.

`LOY-008` Coupon/reward reservation, release, redemption, expiry, refund, and reversal are idempotent and auditable.

`LOY-009` Full refund or full reversal removes the source star. If already-consumed value cannot be unissued, a star-debt entry is recovered from future awards without rewriting history.

`LOY-010` Merchant users can configure reward amount and minimum eligible spend within Admin-configured safety bounds. They cannot edit customer balances directly.

## 10. Payments, fees, refunds, and settlements

### 10.1 Payment model

Payment lifecycle:

`NOT_REQUIRED | PENDING -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED | FAILED | EXPIRED | CANCELLED | REFUND_PENDING -> PARTIALLY_REFUNDED | REFUNDED`

`PAY-001` Cashfree is accessed only through a payment-provider interface; provider IDs and payloads are isolated from order domain contracts.

`PAY-002` Only signed webhooks, authenticated verification, or reconciliation workers may move an online payment to `SUCCEEDED`.

`PAY-003` Webhook signature, amount, currency, merchant/order binding, replay, timestamp, and event uniqueness are validated.

`PAY-004` Late success after cancellation/expiry enters reconciliation and refund; it never resurrects fulfilment.

`PAY-005` Refund requests are idempotent and reconcile provider, order, inventory/return, coupon/reward, loyalty, settlement, and customer projection.

### 10.2 Product-order economics

For each eligible product order:

- item subtotal and tax/discount snapshots;
- customer platform fee: ₹10 (1,000 paise);
- merchant commission: ₹10 (1,000 paise), deducted from settlement;
- actual delivery charge when MyPet captain delivery applies;
- merchant net settlement;
- payment-provider charges/taxes as separately accounted configuration.

`FIN-001` Fees are versioned and snapshotted. No later config change rewrites an order.

`FIN-002` Customer receipt, merchant statement, Admin ledger, payment, and settlement reconcile to the same components.

`FIN-003` Service booking commercial terms are configuration/versioned separately and are not assumed to use the product-order ₹20 model.

## 11. Grooming and veterinary services

### 11.1 Offerings and schedules

`SRV-001` Active verified outlets can publish offerings with service type, pet eligibility, duration, price, tax, preparation instructions, cancellation policy, staff/resource eligibility, and media.

`SRV-002` Availability is generated from outlet hours, staff/resource schedules, buffers, closures, capacity, and existing holds/bookings.

`SRV-003` A slot hold is atomic, expires automatically, and prevents double booking across concurrent clients.

### 11.2 Appointment lifecycle

`HOLD -> BOOKED -> CONFIRMED -> CHECKED_IN -> IN_SERVICE -> COMPLETED`

Alternative states: `HOLD_EXPIRED`, `REJECTED`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED`.

Payment state is separate from appointment state.

`SRV-010` Booking selects customer, pet, provider/outlet, offering, staff/resource if applicable, slot, contact, notes, price snapshot, and payment method.

`SRV-011` Reschedule atomically acquires the new slot before releasing the old slot, or leaves the original booking unchanged.

`SRV-012` One loyalty star is awarded only at `COMPLETED`, subject to merchant minimum spend and source uniqueness.

`SRV-013` Veterinary records, prescriptions, and attachments use least-privilege access, purpose-bound signed URLs, retention policy, and audit.

## 12. Medicine discovery boundary

`MED-001` Customers may search and view approved medicine catalog information and the verified outlet offering it.

`MED-002` Every medicine screen clearly displays “Online purchase unavailable” and routes the user to contact/visit the verified provider subject to platform policy.

`MED-003` Medicine cannot be added to cart, checkout, POS sale, coupon/reward redemption, recurring order, or delivery request through MyPetNew Version 1.

`MED-004` Merchant medicine capability and listings require Admin verification and audit. The platform must be designed for later licence/prescription controls but keeps those paths disabled.

The regulatory baseline includes the Indian Drugs and Cosmetics Act/Rules and Schedule prescription restrictions. Product/legal review is mandatory before commerce activation. Official reference: [CDSCO Drugs Rules](https://cdsco.gov.in/opencms/opencms/en/Acts-and-rules/Drugs-Rules/).

## 13. Recurring product orders

`REC-001` A customer may create a schedule from a delivered/eligible product order or listing with cadence 7, 15, 25, 30, or 35 days.

`REC-002` A schedule stores merchant/outlet, product/variant references, quantities, cadence, next due date, preferred fulfilment/address, and status; it does not freeze future price or stock.

`REC-003` Statuses are `ACTIVE`, `PAUSED`, `CANCELLED`, and `ENDED`. Customers can pause, resume, skip next, change cadence, or cancel.

`REC-004` On due date, a scheduler creates one idempotent renewal proposal and notifies the customer. It does not create an order or charge payment.

`REC-005` Confirmation runs normal cart/quote/checkout rules using current merchant status, listing, stock, price, PIN serviceability, fees, coupon, and loyalty reward.

`REC-006` Unconfirmed proposals expire. Failure advances or pauses according to explicit policy and never loops charges/orders.

## 14. Captain and dispatch requirements

`CAP-001` Captain onboarding requires verified mobile, identity/KYC, vehicle data, bank details, policy consent, and Admin approval before `ACTIVE`.

`CAP-002` Availability requires `ACTIVE`, online status, valid device permission, fresh valid location, and no conflicting active delivery.

`DSP-001` Dispatch starts only from `READY_FOR_PICKUP` for a MyPet-delivery order.

`DSP-002` Nearest eligible-captain offers expire and are idempotent. Rejection/timeout advances bounded attempts; accept-vs-timeout is concurrency-safe.

`DSP-003` Captain receives minimum necessary pickup context before verified pickup and customer delivery context only after assignment/appropriate lifecycle.

`DSP-004` Pickup and delivery require separate expiring, rate-limited proof codes. Codes/hashes are never exposed in DTOs, logs, analytics, or notifications.

`DSP-005` Accepted delivery resumes after app restart. Location stops on offline, sign-out, cancellation, or delivery completion.

`DSP-006` No-captain/dispatch-failed states remain operational exceptions visible to Merchant, Customer, and Admin without fabricating assignment.

## 15. Admin control plane

`ADM-001` Admin dashboards derive counts from canonical lifecycle/payment/dispatch/appointment states and defined time windows.

`ADM-002` Admin can review merchant/outlet/capability and captain applications, with evidence, reason, audit, and notification.

`ADM-003` Admin can observe and permission-safely control orders, payments, refunds, dispatch failures, appointments, loyalty investigations, support/disputes, content, cities, and platform configuration.

`ADM-004` No Admin UI may directly edit an order status, payment success, stock balance, loyalty balance, or settlement amount. It invokes explicit repair/transition commands with invariants and audit.

`ADM-005` Admin access management grants canonical `ADMIN` plus scoped permissions, enforces step-up authentication, and logs changes.

`ADM-006` Analytics disclose metric definition, time zone, currency, inclusion/exclusion rules, and freshness.

## 16. Reviews, support, content, and notifications

`ENG-001` Reviews require a verified delivered order or completed appointment and one review per eligible source/provider/offering policy.

`ENG-002` Support cases link role-safe evidence to order/appointment/payment/dispatch context and maintain assignment, SLA, status, notes, and resolution audit.

`ENG-003` Banners/collections/coupons have ownership, targeting, approval, schedule, active state, priority, and audit. Expired/inactive content is never displayed.

`NOT-001` Notifications use durable outbox events, templates, user preferences, deduplication, retry/backoff, dead-letter handling, and delivery audit.

`NOT-002` Transactional notifications cover OTP, order/appointment transitions, payment/refund, dispatch, loyalty reward/expiry, recurring proposal, and support updates.

## 17. Data and API contracts

### 17.1 Aggregate ownership

| Aggregate | Owning module |
|---|---|
| Identity, session, role, admin permission | Identity & Access |
| Merchant organization, outlet, verification, staff | Provider |
| Listing, variant, barcode, batch, inventory ledger | Catalog & Inventory |
| Cart, quote, order, order history, returns | Commerce |
| Payment, refund, fee ledger, settlement | Payments & Finance |
| Loyalty ledger, reward, coupon reservation | Loyalty & Promotions |
| Service offering, availability, hold, appointment | Appointments |
| Captain, location, offer, dispatch job, proof | Delivery |
| Notification, support, content, review | Engagement & Operations |

Modules do not write each other's tables. Cross-module synchronous calls use typed internal interfaces; durable side effects use an outbox.

### 17.2 API error contract

Every non-2xx response uses:

```json
{
  "code": "STABLE_MACHINE_CODE",
  "message": "Safe user-facing summary",
  "traceId": "bounded-trace-id",
  "fieldErrors": { "field": "reason" },
  "timestamp": "ISO-8601",
  "path": "/api/v1/..."
}
```

Clients branch on HTTP status and stable code, never English message text.

### 17.3 Idempotency

All transactional POST/command endpoints declare idempotency scope, key format, request fingerprint, retention, replay response, mismatch behavior, and concurrency semantics.

## 18. Non-functional requirements

### 18.1 Security and privacy

- OWASP ASVS/MASVS-aligned controls appropriate to web/mobile/API.
- Short-lived access tokens, rotating refresh tokens, device/session revocation, secure storage, and no secrets in clients.
- Deny-by-default authorization at controller and service boundaries; tenant isolation tested at repository/database access.
- Encryption in transit and at rest; sensitive fields minimized and encrypted where justified.
- Secret manager, rotation, signed webhook validation, strict CORS, security headers, rate limits, abuse monitoring, and dependency/secret scanning.
- Audit logs are append-only, access-controlled, retention-defined, and free from OTP/payment/document secrets.
- Customer consent, privacy notice, data export/deletion, retention, and purpose limitation are implemented before launch.

### 18.2 Reliability and consistency

- PostgreSQL transactions protect local aggregate invariants.
- Outbox/inbox patterns protect durable cross-module effects.
- Workers are replay-safe and observable; scheduler ownership uses distributed locking.
- Cache is never authoritative for money, stock, loyalty, payment, order, appointment, or permission.
- Backup, point-in-time recovery, restore drill, migration rollback/forward-fix, and disaster-recovery objectives are documented and tested.

### 18.3 Performance targets

At pilot load, measured at server boundary excluding third-party latency:

- p95 read API <= 400 ms;
- p95 transactional command <= 800 ms;
- search p95 <= 700 ms;
- no integrity loss at 50 concurrent attempts against the same final stock unit/appointment slot/reward;
- pagination and bounded queries on every collection endpoint;
- mobile screens avoid unbounded payloads and remain usable on constrained Indian mobile networks.

### 18.4 Accessibility and usability

- WCAG 2.2 AA intent for Admin web and React Native accessibility equivalents.
- 48dp touch targets, meaningful labels/roles/hints, dynamic type/font scaling, focus order, contrast, reduced motion, keyboard/screen-reader testing, and non-color status cues.
- Loading, empty, offline, permission-denied, validation, conflict, retry, and terminal states are designed for each critical screen.

### 18.5 Observability

- Structured logs with trace/request/idempotency IDs and safe actor/aggregate identifiers.
- Metrics for API errors/latency, order funnel, stock conflicts, payment reconciliation, dispatch attempts, appointment conflicts, loyalty/reward effects, worker lag, notification failures, and security events.
- Distributed traces across inbound command, database transaction, outbox, worker, and provider adapter.
- Alerts link to runbooks and avoid customer PII.

## 19. Release governance

A feature is “Done” only when:

1. requirement and lifecycle are documented;
2. schema/migration, API/DTO, authorization, validation, idempotency, concurrency, and audit are implemented;
3. role clients consume canonical contracts without mock/production fallback;
4. unit, integration, contract, E2E, adversarial, accessibility, and relevant device tests pass;
5. telemetry, alerts, support handling, runbook, rollback/forward-fix, and data reconciliation exist;
6. legal/privacy/security acceptance is complete when applicable;
7. traceability links requirement -> ticket -> code -> test -> evidence.

Compilation, HTTP 200, rendered screens, demo data, or manually edited database rows do not constitute acceptance.

## 20. Sprint 1 acceptance summary

Sprint 1 must prove the walking skeleton end to end:

1. Customer verifies mobile OTP.
2. Admin-approved Merchant operates an active product outlet.
3. Merchant scans a valid barcode and creates an outlet-owned listing.
4. Merchant receives/counts stock through the inventory ledger.
5. Customer browses, authenticates, creates a single-merchant cart, receives a server quote, and places an idempotent pickup/pay-on-fulfilment order.
6. Merchant accepts, prepares, marks ready, and completes pickup using an authorized transition.
7. A separate Merchant POS scan completes a customer-associated eligible sale.
8. Exactly one merchant-specific loyalty star is awarded.
9. Duplicate requests/scans/replays and concurrent races produce no duplicate order, sale, stock movement, star, reward, or cross-tenant leak.
10. Every mandatory gate in `docs/qa/SPRINT_1_HARD_TEST_CASES.md` passes with stored evidence.

