# MyPetNew

MyPetNew is a Tirupati-first, multi-city-ready marketplace for pet products, grooming, veterinary care, view-only medicine discovery, in-store POS loyalty, and MyPet-managed delivery.

This repository is currently operating in **Sprint 1 frontend-first mode**. The PRD and flow documents remain design/reference inputs, but only Sprint 1 is authorized for implementation. Later sprint execution plans have been removed and must not be inferred or implemented until a new sprint baseline is explicitly created.

## Authoritative documents

| Document | Purpose |
|---|---|
| [Product Requirements Document](docs/product/PRD.md) | Product scope, roles, rules, lifecycles, acceptance criteria, and non-functional requirements |
| [Decision Log](docs/product/DECISIONS.md) | Locked product and architecture decisions with rationale |
| [System Context and Reuse Boundaries](docs/architecture/SYSTEM_CONTEXT.md) | Target architecture, domain ownership, security boundaries, and selective-reuse rules |
| [Sprint 1 Frontend-First Execution Plan](docs/sprints/SPRINT_PLAN.md) | The only active implementation sprint and its frontend-first execution order |
| [Customer Commerce Flow](docs/flows/CUSTOMER_COMMERCE.md) | Product-flow reference for UX and future planning |
| [Merchant Barcode, POS and Loyalty Flow](docs/flows/MERCHANT_BARCODE_POS_LOYALTY.md) | Merchant-flow reference for UX and Sprint 1 behavior |
| [Services and Recurring Flow](docs/flows/SERVICES_RECURRING.md) | Design/reference input only unless covered by Sprint 1 |
| [Captain and Admin Operations Flow](docs/flows/CAPTAIN_ADMIN_OPERATIONS.md) | Design/reference input; only Sprint 1 shell/approval behavior is active |
| [Notification Delivery Flow](docs/flows/NOTIFICATIONS.md) | Sprint 1 notification/device/deep-link contract |
| [Sprint 1 Hard Test Contract](docs/qa/SPRINT_1_HARD_TEST_CASES.md) | Mandatory adversarial, concurrency, security, device, and E2E release gates |
| [Requirements Traceability](docs/qa/TRACEABILITY_MATRIX.md) | Sprint 1 active coverage plus deferred product requirements |

## Source-of-truth order

When documents or code disagree, use this precedence:

1. `docs/product/DECISIONS.md`
2. `docs/product/PRD.md`
3. flow contracts under `docs/flows/`
4. `docs/sprints/SPRINT_PLAN.md`
5. tests and implementation

No screen, API response, database entity, background worker, or admin action may invent a competing business state.

## Current execution rule

**Only Sprint 1 is active.**

The immediate priority is frontend design quality across the Sprint 1 Customer and Merchant flows, plus only the Captain/Admin shell behavior explicitly required by Sprint 1.

The working sequence is:

`screen inventory -> visual system -> Customer screens -> Merchant screens -> navigation/back/deep links -> loading/error/offline/accessibility states -> bind Sprint 1 APIs -> connected E2E -> Sprint 1 certification`

Do not implement later payment, settlement, delivery, recurring-order, service, coupon, or other future-sprint work simply because it exists in the PRD.

## Sprint 1 transaction spine

`OTP identity -> verified merchant outlet -> merchant-owned barcode listing -> stock -> single-merchant pickup/pay-on-fulfilment order -> POS sale -> merchant-specific loyalty star -> durable Firebase push`

The Kotlin/Spring Boot backend remains the only business authority. Supabase supplies managed PostgreSQL and object storage; role apps do not access domain tables directly. Firebase Cloud Messaging supplies mobile push through a provider-neutral backend adapter, while each app fetches canonical state from the API after a notification.

## Implemented Sprint 1 source baseline

The repository contains a Kotlin/Spring Boot modular monolith, private Flyway schema, rotating refresh sessions, Supabase private-storage adapter, encrypted device registration, durable notification attempts with an FCM adapter, shared TypeScript contracts/design tokens, separate Customer/Merchant/Captain Expo shells, and a Next.js Admin shell.

The existing source baseline is **not yet Sprint 1 certified**. Core commerce persistence, production OTP, several role workflows, physical-device scanner/push evidence, and connected staging evidence still require completion. Frontend work must expose those gaps rather than hiding them behind mock or placeholder success states.

Use Java 21, Node 22.23.2, and pnpm 11.21.0:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

The current release blockers remain recorded in [Sprint 1 evidence](docs/qa/evidence/sprint-1/README.md).
