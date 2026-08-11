# MyPetNew

MyPetNew is a Tirupati-first, multi-city-ready marketplace for pet products, grooming, veterinary care, view-only medicine discovery, in-store POS loyalty, and MyPet-managed delivery.

This repository starts contract-first. The documents below are the source of truth for implementation. Existing `MyPet` and `happypets` code may be reused only after it satisfies these contracts.

## Authoritative documents

| Document | Purpose |
|---|---|
| [Product Requirements Document](docs/product/PRD.md) | Product scope, roles, rules, lifecycles, acceptance criteria, and non-functional requirements |
| [Decision Log](docs/product/DECISIONS.md) | Locked product and architecture decisions with rationale |
| [System Context and Reuse Boundaries](docs/architecture/SYSTEM_CONTEXT.md) | Target architecture, domain ownership, security boundaries, and selective-reuse rules |
| [Sprint Execution Plan](docs/sprints/SPRINT_PLAN.md) | Ordered implementation plan, tickets, dependencies, and exit gates |
| [Customer Commerce Flow](docs/flows/CUSTOMER_COMMERCE.md) | Browse, cart, checkout, payment, order, cancellation, and recurring-order flows |
| [Merchant Barcode, POS and Loyalty Flow](docs/flows/MERCHANT_BARCODE_POS_LOYALTY.md) | Barcode onboarding, stock, POS billing, customer association, stars, and rewards |
| [Services and Recurring Flow](docs/flows/SERVICES_RECURRING.md) | Grooming, veterinary, medicine discovery, appointment, and recurring-order flows |
| [Captain and Admin Operations Flow](docs/flows/CAPTAIN_ADMIN_OPERATIONS.md) | Dispatch, captain delivery, platform oversight, refunds, and support |
| [Notification Delivery Flow](docs/flows/NOTIFICATIONS.md) | Supabase-backed outbox, Firebase device registration, push delivery, deep links, retries, and token lifecycle |
| [Sprint 1 Hard Test Contract](docs/qa/SPRINT_1_HARD_TEST_CASES.md) | Mandatory adversarial, concurrency, security, device, and E2E release gates for Sprint 1 |
| [Requirements Traceability](docs/qa/TRACEABILITY_MATRIX.md) | Mapping from PRD requirements to sprints, flows, and tests |

## Source-of-truth order

When documents or code disagree, use this precedence:

1. `docs/product/DECISIONS.md`
2. `docs/product/PRD.md`
3. flow contracts under `docs/flows/`
4. `docs/sprints/SPRINT_PLAN.md`
5. tests and implementation

No screen, API response, database entity, background worker, or admin action may invent a competing business state.

## Reference repositories

- [`thrinnadhh/happypets`](https://github.com/thrinnadhh/happypets): storefront, catalog presentation, coupon, delivery-quote, Razorpay, banner, and analytics reference only.
- [`thrinnadhh/MyPet`](https://github.com/thrinnadhh/MyPet): modular-monolith domains, order integrity, dispatch, loyalty, recurring-order, mobile, and operations reference only.

Reference does not mean automatic reuse. Every reused component must pass the compatibility checklist in [System Context and Reuse Boundaries](docs/architecture/SYSTEM_CONTEXT.md).

## Current delivery target

Sprint 1 is a production-shaped walking skeleton:

`OTP identity -> verified merchant outlet -> merchant-owned barcode listing -> stock -> single-merchant pickup/pay-on-fulfilment order -> POS sale -> merchant-specific loyalty star -> durable Firebase push`

The Kotlin/Spring Boot backend remains the only business authority. Supabase supplies managed PostgreSQL and object storage; role apps do not access domain tables directly. Firebase Cloud Messaging supplies mobile push through a provider-neutral backend adapter, while each app fetches canonical state from the API after a notification.

Sprint 1 is complete only when every applicable test in [Sprint 1 Hard Test Contract](docs/qa/SPRINT_1_HARD_TEST_CASES.md) passes with evidence.

## Implemented Sprint 1 source baseline

The repository now contains a Kotlin/Spring Boot modular monolith, a private Flyway schema, shared TypeScript contracts/design tokens, separate Customer/Merchant/Captain Expo applications, and a Next.js Admin application. The automated walking skeleton exercises provider approval, outlet-scoped barcode catalog and inventory, pickup quote/order transitions, POS, merchant-scoped loyalty, role-safe device registration, and notification inbox projection.

Use Java 21, Node 22.23.2, and pnpm 11.21.0:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
```

`corepack pnpm verify` runs secret-boundary scanning, the backend quality/coverage gate, client lint/typecheck/coverage, and production builds. Configuration keys are documented in [`.env.example`](.env.example); real secrets must remain in the server/build secret store.

The current release status and infrastructure/device blockers are recorded in [Sprint 1 evidence](docs/qa/evidence/sprint-1/README.md). A green source build does not substitute for isolated Supabase/Firebase evidence or physical-device scanner/push tests.
