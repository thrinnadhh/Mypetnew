# Requirements Traceability Matrix

Status: **Sprint 1 active / later implementation deferred**

Version: **2.0**

Date: **2026-08-11**

## 1. Purpose

This matrix prevents implementation claims without requirement, flow, test, and evidence coverage.

Only **Sprint 1** is currently authorized for implementation. Product requirements outside Sprint 1 remain design/reference input and are marked `DEFERRED`. They must not trigger backend, database, payment, delivery, settlement, recurring-order, or other implementation work until a new sprint baseline is explicitly created.

## 2. Product requirement coverage

| Requirement family | Locked decisions | Owning module | Canonical flow | Active delivery | Mandatory verification |
|---|---|---|---|---|---|
| roles and Admin permissions | D-002, D-004 | Identity & Access | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S1 | S1-AUTH-008..011, S1-SEC-001, S1-SEC-011 |
| Merchant organization/outlet/capability | D-005, D-013 | Provider | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-TEN-001..010, S1-E2E-001 |
| guest discovery and Customer OTP | D-010 | Identity, Discovery | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-AUTH-001..007, S1-ORD-003..004 |
| single-merchant cart | D-006 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-ORD-001..005 |
| quote/pricing/fees | D-012 | Commerce, Finance | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-ORD-006..014, S1-E2E-002 |
| pickup/pay-on-fulfilment | D-009, DD-008 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-ORD-007..020, S1-E2E-002..003 |
| canonical Sprint 1 order lifecycle/DTOs | D-001, DD-006..007 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-ORD-015..020, S1-E2E-003 |
| merchant-owned listings | D-007 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-TEN, S1-BAR-005..010, S1-E2E-006 |
| barcode onboarding | D-008, DD-001..002 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-BAR-001..018, physical scanner gate |
| inventory ledger/counting | DD-006 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-INV-001..015, S1-OPS-010 |
| POS billing | D-008, DD-004 | Catalog & Inventory, Finance | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-POS-001..015, S1-E2E-004 |
| loyalty onboarding/POS star baseline | D-014, D-015 | Loyalty & Promotions | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-LOY-001..018, S1-E2E-004..005 |
| medicine view-only baseline | D-020, DD-009 | Provider, Catalog | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S1 | S1-BAR-018, S1-ORD-005, S1-POS-002, S1-E2E-008 |
| Supabase PostgreSQL/private schema | D-003, D-024, DD-011 | owned server repositories | all Sprint 1 transaction flows | S1 | S1-SUP-001..007, 011..012; S1-OPS-001..010 |
| Supabase private object storage | D-024, DD-012 | Provider via `DocumentStore` | [Notification](../flows/NOTIFICATIONS.md) | S1 | S1-SUP-004, 006, 008..010, 012 |
| Firebase mobile push and in-app notifications | D-025, DD-013..014 | Engagement & Operations | [Notification](../flows/NOTIFICATIONS.md) | S1 | S1-PUSH-001..019, S1-E2E-009 |
| security/privacy/accessibility | DD-006..007 | cross-cutting | all Sprint 1 flows | S1 | S1-SEC-001..012, S1-MOB-001..012 |
| reliability/observability/recovery | product principles | cross-cutting | all Sprint 1 flows | S1 | S1-OPS-001..010 |
| richer catalog/search/favorites/media/batch depth | product scope | Catalog | Customer/Merchant flows | DEFERRED | design/reference only |
| online payment/Cashfree | D-011 | Payments & Finance | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | DEFERRED | no implementation authorized |
| coupons/reward redemption/refunds/settlement depth | D-012, D-016..018 | Commerce, Finance, Loyalty | Customer/Merchant/Admin flows | DEFERRED | no implementation authorized |
| grooming/veterinary appointments | D-020, D-021 | Appointments | [Services/Recurring](../flows/SERVICES_RECURRING.md) | DEFERRED | design/reference only |
| recurring 7/15/25/30/35 | D-019 | Commerce | [Services/Recurring](../flows/SERVICES_RECURRING.md) | DEFERRED | design/reference only |
| Captain delivery/location/dispatch/proofs | D-009 | Delivery | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | DEFERRED | Captain remains Sprint 1 shell only |
| expanded Admin control plane | D-004 | Operations | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | DEFERRED | only Sprint 1 provider-review needs are active |
| reviews/support/content/multi-city expansion | product scope | Operations | relevant flows | DEFERRED | design/reference only |

## 3. Sprint 1 ticket-to-test matrix

| Sprint 1 ticket | Minimum hard-test coverage |
|---|---|
| S1-01 repository/CI | S1-ARC-001, 004..006, S1-SEC-010 |
| S1-02 backend/modular monolith/Supabase | S1-ARC-002..003, 007..010, S1-SUP-001..012, S1-OPS-001..005, 009 |
| S1-03 role client/Firebase shells | S1-ARC-004..005, S1-AUTH-008..009, S1-MOB-001, 008, 011, S1-PUSH-001..008, 014..019 |
| S1-04 OTP/session | S1-AUTH-001..007, 012, S1-SEC-005, 007..009 |
| S1-05 RBAC/Admin permissions | S1-AUTH-008..011, S1-SEC-001, 011 |
| S1-06 provider/outlet/PIN | S1-TEN-001..010, S1-E2E-001 |
| S1-07 listing/barcode domain | S1-BAR-001..011, 018, S1-INV-001 |
| S1-08 scanner UI/offline | S1-BAR-012..017, S1-MOB-002..011, physical scanner gate |
| S1-09 inventory ledger | S1-INV-002..015, S1-OPS-003..010 |
| S1-10 Merchant inventory UI | S1-BAR-012..017, S1-INV-009..012, S1-MOB-002..007 |
| S1-11 Customer catalog/cart | S1-ORD-001..005, S1-AUTH-001, S1-MOB-002..008 |
| S1-12 quote/fees | S1-ORD-006..010, 014, S1-E2E-002 |
| S1-13 checkout/order aggregate | S1-INV-005..008, S1-ORD-011..014, 019..020, S1-E2E-002 |
| S1-14 Merchant fulfilment | S1-ORD-015..020, S1-E2E-003 |
| S1-15 POS | S1-POS-001..015, S1-INV-006..007, S1-E2E-004 |
| S1-16 loyalty | S1-LOY-001..018, S1-E2E-004..005 |
| S1-17 outbox/inbox/FCM | S1-INV-013..014, S1-POS-010..011, S1-LOY-010..013, S1-OPS-004..005, S1-PUSH-001..019 |
| S1-18 connected certification | S1-E2E-001..009 plus every pass-matrix gate, including Supabase and physical native-push evidence |

## 4. Frontend-first traceability rule

Every Sprint 1 screen must map to:

`screen -> actor -> Sprint 1 ticket -> API/state authority -> loading/error/offline states -> navigation/back/deep-link behavior -> test/evidence`

A polished screen with mock-only behavior is not complete. A backend endpoint without a usable Sprint 1 screen is also not complete when the ticket requires role UI.

## 5. Implementation row template

| Requirement ID | Decision | Ticket | API/event/schema | Code module/screen | Automated test | Manual/device evidence | Observability/runbook | Status |
|---|---|---|---|---|---|---|---|---|
| example | D-xxx | S1-yy | link/path | link/path | test ID/report | evidence link | dashboard/runbook | NOT RUN/PASS |

## 6. Traceability audit rules

The release traceability gate fails when:

- changed business behavior has no PRD/decision entry;
- Sprint 1 behavior has no ticket or test;
- a ticket has no happy/failure/race coverage;
- a screen invents a state or total absent from canonical contracts;
- a client action has no real API path when the ticket requires integration;
- a test claims coverage but does not assert the invariant;
- tenant/role boundaries are tested only through happy paths;
- migration/API/event changes lack compatibility evidence;
- a physical-device requirement is replaced by a unit/emulator-only result;
- later/deferred product scope is implemented without a newly approved sprint baseline;
- evidence points to an unversioned mutable/latest artifact.

## 7. Release status

Sprint 1 remains the only active release target. `DEFERRED` rows are not implementation commitments and must not be reported as completed work.
