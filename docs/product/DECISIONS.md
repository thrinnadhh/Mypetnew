# MyPetNew Decision Log

Status: **Authoritative**  
Version: **1.1**  
Date: **2026-08-11**  
Owner: **Product and Platform**

This file records decisions that must not be reinterpreted by individual apps or services. A change requires a new dated decision entry and corresponding PRD, flow, sprint, test, and migration updates.

## Locked decisions

| ID | Decision | Consequence |
|---|---|---|
| D-001 | Build MyPetNew as a fresh implementation and selectively reuse compatible modules from `MyPet`; use `happypets` as a feature/reference source. | No wholesale copy, schema import, or legacy status adoption is allowed. |
| D-002 | Deliver separate Customer, Merchant, and Captain Expo React Native apps plus a Next.js Admin web app. | Shared packages may contain contracts and design tokens, but role-specific navigation and permissions remain separate. |
| D-003 | Use a Kotlin + Spring Boot modular monolith with PostgreSQL as the transactional source of truth. | Bounded contexts are modules in one deployable application until measured scale justifies extraction. |
| D-004 | Launch with four canonical roles: `CUSTOMER`, `MERCHANT`, `CAPTAIN`, and `ADMIN`. There is no `SUPER_ADMIN`. | Admin authority is granted through scoped permissions, not a second role name. |
| D-005 | A merchant organization may own multiple outlets and multiple verified provider types: product store, groomer, veterinary clinic/hospital, and view-only medicine catalog. | Tenant and outlet ownership must be explicit on every merchant-owned aggregate. |
| D-006 | A customer cart may contain items from exactly one merchant outlet. | Adding another merchant's item requires clearing or explicitly replacing the cart; checkout never silently splits or merges orders. |
| D-007 | Each merchant owns separate product listings. The same barcode may exist at different merchants; a normalized barcode must be unique within one merchant outlet. | There is no launch-time global product master or cross-merchant price identity. |
| D-008 | Barcode scanning supports merchant product onboarding, stock count/adjustment, and POS billing/loyalty. Customer barcode scanning is out of Version 1. | Scanner permissions and offline replay belong only to the Merchant app in Version 1. |
| D-009 | Product orders support MyPet captain delivery and customer store pickup. Merchant self-delivery and third-party logistics are out of Version 1. | Fulfilment mode is explicit and immutable after merchant acceptance except through cancellation/reorder. |
| D-010 | Customer browsing is public. Mobile OTP is required before checkout or account-specific actions. An optional PIN may be added later. | No password is required at launch and guest carts must merge safely after authentication. |
| D-011 | Cashfree is the first payment adapter behind a provider-neutral payment interface. | Client apps never declare payment success; webhooks and server reconciliation own payment state. |
| D-012 | MyPet charges a ₹10 customer platform fee and a ₹10 merchant commission on every eligible product order, excluding actual delivery charges. | Pricing snapshots expose each component; merchant settlement and invoice calculations must reconcile exactly. |
| D-013 | Launch serviceability uses merchant-managed, validated six-digit Indian PIN codes. | Delivery checkout checks the selected outlet's active PIN-code set. Store pickup does not require delivery serviceability. |
| D-014 | Loyalty is merchant-specific. Eligible events are: one merchant-verified onboarding star per customer/merchant relationship, one delivered marketplace product order, one completed in-store POS purchase, one completed grooming booking, and one completed veterinary booking. | A customer never has one global star balance. Idempotent source-event references are mandatory. |
| D-015 | Each eligible transaction earns one star, not one per item. The merchant configures minimum eligible spend; the default is ₹100. | Split payments, multiple quantities, and repeated webhooks cannot produce extra stars. |
| D-016 | Ten earned stars are consumed to issue one merchant-funded, merchant-configured flat-value reward. Unused remainder stars carry forward. | Reward issuance and star consumption are one atomic ledger operation. |
| D-017 | A loyalty reward expires 90 days after issuance and may stack with at most one normal coupon from the same merchant. | Pricing must validate both instruments server-side and reserve/release them with checkout. |
| D-018 | Cancellation, rejection, failed payment, expired hold, and abandoned checkout earn no star. A full refund or fully reversed eligible transaction reverses its star. | If reversal would make a previously redeemed reward invalid, record recoverable star debt; never mutate history. |
| D-019 | Recurring product orders support fixed cadences of 7, 15, 25, 30, and 35 days. A due schedule creates a renewal proposal requiring customer confirmation. | No automatic COD placement or payment mandate charge occurs in Version 1. Price, stock, serviceability, coupon, and reward are recalculated. |
| D-020 | Version 1 includes pet products, grooming, veterinary clinics/hospitals, and medicine discovery. Medicines are view-only and cannot enter MyPet cart, checkout, subscription, or POS transactions. | A later licensed-pharmacy decision is required before medicine commerce. |
| D-021 | Grooming and veterinary bookings have an appointment lifecycle separate from product orders. | Appointment `PAID` is a payment state, not a booking/fulfilment state. |
| D-022 | Sprint 1 delivers an executable walking skeleton: auth, provider/outlet, merchant-owned barcode catalog, stock, single-merchant pickup/pay-on-fulfilment order, POS loyalty, and hard CI gates. | Sprint 1 is not complete based on screens, HTTP 200 responses, or compilation alone. |
| D-023 | The repository remains private and carries no open-source licence while architecture and business rules stabilize. | Redistribution rights are not granted. |
| D-024 | Use Supabase as managed infrastructure for PostgreSQL and object storage. The Kotlin/Spring Boot backend remains the only domain API and owns Flyway migrations, authorization, transactions, and signed storage access. | Role apps never connect directly to domain tables. Supabase Auth, direct client Data API access, Realtime, and Edge Functions are not authorities for Version 1 business flows. |
| D-025 | Use Firebase Cloud Messaging (FCM) as the launch mobile-push adapter behind `NotificationProvider`; Expo apps use `expo-notifications` to register native device tokens and handle notifications/deep links. | FCM credentials stay server-side, projects are isolated by environment, iOS delivery uses the APNs configuration attached to FCM, and notification delivery never changes business state. |

## Derived safety decisions

These decisions follow from the locked choices and close implementation ambiguity.

| ID | Derived rule |
|---|---|
| DD-001 | Barcode canonicalization strips permitted separators, validates GTIN check digits for GTIN-8/12/13/14, preserves an explicit `INTERNAL` code type, and stores the raw scan only for audit. |
| DD-002 | `merchant_id + outlet_id + barcode_type + normalized_value` is the uniqueness boundary. Cross-outlet reuse inside the same organization is explicit, not accidental. |
| DD-003 | The onboarding star requires an authenticated Customer session and a short-lived merchant/outlet challenge confirmed by both apps. A merchant cannot type a phone number and grant a star. |
| DD-004 | POS star issuance requires a completed sale, a customer association, minimum spend, and an idempotent sale reference. Anonymous POS sales do not earn a star. |
| DD-005 | Every money amount is stored as integer paise. Floating-point arithmetic is prohibited for prices, taxes, fees, discounts, rewards, payments, and settlements. |
| DD-006 | Every order, appointment, payment, dispatch, loyalty, stock, coupon, and reward transition writes an immutable history/audit record containing actor, source, timestamp, idempotency key, and trace ID. |
| DD-007 | Client-side roles, totals, prices, stock, fees, reward balances, OTP results, and status transitions are advisory displays only. Server authorization and state machines are authoritative. |
| DD-008 | Store pickup uses `PAY_ON_FULFILMENT` in Sprint 1. It must not be mislabeled as a captured online payment. |
| DD-009 | A medicine offering has `commerce_mode=VIEW_ONLY`; all server-side order and POS paths reject it even if a client is modified. |
| DD-010 | Future changes to fees, loyalty, or cadence are versioned and affect new transactions only; existing snapshots retain the rule version used at creation. |
| DD-011 | Application tables live in a private, non-client-exposed PostgreSQL schema. Only the backend database identity receives domain-table privileges; no Supabase secret/service-role key is shipped to a role app or Admin browser. |
| DD-012 | Private merchant-verification, medical, support, and proof objects use private Supabase Storage buckets and short-lived, purpose-bound signed access issued only after backend authorization. |
| DD-013 | A push payload contains an opaque notification/resource reference and safe routing metadata, never OTPs, access tokens, full phone numbers, payment evidence, medical details, proofs, or other sensitive business data. The receiving app reloads canonical state from the API. |
| DD-014 | Device registrations are scoped by environment, app, installation, platform, user/role, token, and session. Rotation, logout, permission revocation, provider invalidation, staleness, and account suspension deactivate the appropriate registration without deleting delivery audit. |

## Change procedure

Every proposed decision change must include:

1. business rationale and affected users;
2. migration and backward-compatibility plan;
3. updated lifecycle/sequence flows;
4. updated acceptance and adversarial tests;
5. finance, security, privacy, or legal review when applicable;
6. rollout, observability, and rollback plan.
