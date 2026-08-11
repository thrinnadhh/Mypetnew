# Requirements Traceability Matrix

Status: **Living release-control document**  
Version: **1.0**  
Date: **2026-08-11**

## 1. Purpose

This matrix prevents “implemented” claims without a requirement, owner, flow, sprint, test, and evidence path. It begins at product-family level; implementation PRs add row-level links to API/schema/code and immutable test evidence.

## 2. Product requirement coverage

| Requirement family | Locked decisions | Owning module | Canonical flow | Delivery sprint(s) | Mandatory verification |
|---|---|---|---|---|---|
| roles and Admin permissions | D-002, D-004 | Identity & Access | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S1, S8 | S1-AUTH-008..011, S1-SEC-001, S1-SEC-011 |
| Merchant organization/outlet/capability | D-005, D-013 | Provider | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1, S3, S5 | S1-TEN-001..010, S1-E2E-001 |
| guest discovery and Customer OTP | D-010 | Identity, Discovery | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1, S2 | S1-AUTH-001..007, S1-ORD-003..004 |
| pet profiles and medical context | D-020, D-021 | Customer, Appointments | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S5 | service E2E, medical authorization and document security gates |
| single-merchant cart | D-006 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1, S2 | S1-ORD-001..005 |
| quote/pricing/fees | D-012 | Commerce, Finance | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1, S2 | S1-ORD-006..014, S1-E2E-002 |
| pickup/pay-on-fulfilment | D-009, DD-008 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1 | S1-ORD-007..020, S1-E2E-002..003 |
| canonical order lifecycle/DTOs | D-001, DD-006..007 | Commerce | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S1, S2, S3 | S1-ORD-015..020, S1-E2E-003 |
| Cashfree online payment | D-011 | Payments & Finance | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md) | S2 | payment webhook/replay/reconciliation/late-success/refund E2E |
| returns/refunds/settlement | D-012, D-018 | Commerce, Payments, Finance, Loyalty | [Customer Commerce](../flows/CUSTOMER_COMMERCE.md), [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S2, S3, S6, S8 | refund/reconciliation/ledger conservation and Admin permission gates |
| merchant-owned listings | D-007 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1, S3 | S1-TEN, S1-BAR-005..010, S1-E2E-006 |
| barcode onboarding | D-008, DD-001..002 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 | S1-BAR-001..018, physical scanner gate |
| inventory ledger/counting | DD-006 | Catalog & Inventory | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1, S3 | S1-INV-001..015, S1-OPS-010 |
| POS billing | D-008, DD-004 | Catalog & Inventory, Finance | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1, S3 | S1-POS-001..015, S1-E2E-004 |
| loyalty eligible sources | D-014, D-015 | Loyalty & Promotions | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1, S5, S6 | S1-LOY-001..011, S1-E2E-004..005 |
| ten-star flat reward/expiry | D-016, D-017 | Loyalty & Promotions | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S1 domain, S2/S6 UI/integration | S1-LOY-012..018; coupon/reward checkout race tests |
| loyalty reversal/star debt | D-018 | Loyalty & Promotions | [Merchant Barcode/POS](../flows/MERCHANT_BARCODE_POS_LOYALTY.md) | S6 | S1-LOY-015..018 baseline; full refund/service/settlement E2E |
| grooming/veterinary offerings and slots | D-020, D-021 | Appointments | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S5 | concurrent final-slot, hold expiry, reschedule, cancellation/payment tests |
| completed-service loyalty | D-014, D-018 | Appointments, Loyalty | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S5, S6 | completion replay, no-show/cancel/refund reversal, tenant tests |
| medicine view-only | D-020, DD-009 | Provider, Catalog | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S1, S5, S11 | S1-BAR-018, S1-ORD-005, S1-POS-002, S1-E2E-008 |
| recurring 7/15/25/30/35 | D-019 | Commerce | [Services/Recurring](../flows/SERVICES_RECURRING.md) | S7 | duplicate scheduler, time boundary, pause/due, confirm/expire, current-state validation E2E |
| Captain onboarding/location | D-002, D-009 | Delivery | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S4 | KYC/role, physical background location, stale/offline/busy/suspend tests |
| dispatch/offers/proofs | D-009 | Delivery, Commerce | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S4 | duplicate ready, no captain, rejection, timeout, accept race, wrong proof, restart E2E |
| Admin control plane | D-004 | Engagement & Operations plus owning modules | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S8 | permission matrix, no generic state/balance edit, audit/reconciliation E2E |
| reviews/support/content | product scope | Engagement & Operations | [Captain/Admin](../flows/CAPTAIN_ADMIN_OPERATIONS.md) | S8, S9 | verified-source, evidence privacy, XSS/media, SLA, notification replay tests |
| multi-city/PIN expansion | D-013 | Provider, Operations | all affected | S10 | city activation/isolation, PIN conflict/import, no-code-change test |
| security/privacy/accessibility | DD-006..007 | cross-cutting | all flows | S1 continuously, S10/S11 certification | S1-SEC-001..012, S1-MOB-001..012, external review |
| reliability/observability/recovery | product principles | cross-cutting | all flows | every sprint, S10 | S1-OPS-001..010, load/chaos/restore/full E2E |

## 3. Sprint 1 ticket-to-test matrix

| Sprint 1 ticket | Minimum hard-test coverage |
|---|---|
| S1-01 repository/CI | S1-ARC-001, 004..006, S1-SEC-010 |
| S1-02 backend/modular monolith | S1-ARC-002..003, 007..010, S1-OPS-001..005 |
| S1-03 role client shells | S1-ARC-004..005, S1-AUTH-008..009, S1-MOB-001, 008, 011 |
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
| S1-17 outbox/inbox | S1-INV-013..014, S1-POS-010..011, S1-LOY-010..013, S1-OPS-004..005 |
| S1-18 connected certification | S1-E2E-001..008 plus every pass-matrix gate |

## 4. Implementation row template

Every implementation PR adds or updates a row using this schema:

| Requirement ID | Decision | Ticket/issue | API/event/schema | Code module | Automated test | Manual/device evidence | Observability/runbook | Status |
|---|---|---|---|---|---|---|---|---|
| example | D-xxx | Sx-yy / issue | link/path | link/path | test ID/report | evidence link | dashboard/runbook | NOT RUN/PASS |

## 5. Traceability audit rules

The release traceability gate fails when:

- a changed business behavior has no PRD/decision entry;
- a requirement has no delivery sprint/ticket;
- a ticket has no happy/failure/race tests;
- a test claims coverage but does not assert the stated invariant;
- role UI uses a field/state absent from canonical contract;
- migration/API/event changes are missing compatibility/consumer evidence;
- a manual/device requirement is replaced by a unit test;
- evidence points to a mutable/latest report without commit/build identity;
- a known failure is relabeled or excluded without approved rationale.

## 6. Release status

Initial status for every row and test is `NOT RUN`. This repository defines what must be built and proven; it does not claim implementation or production readiness.

