# MyPetNew

MyPetNew is a Tirupati-first, multi-city-ready marketplace for pet products, grooming, veterinary care, view-only medicine discovery, in-store POS loyalty, and MyPet-managed delivery.

## Current repository state

The existing frontend implementation has been intentionally removed so the client experience can be redesigned from a clean baseline. There are currently **no Customer, Merchant, Captain, or Admin frontend applications in this repository**.

The Kotlin/Spring Boot backend, database/migration work, infrastructure, product requirements, architecture documents, flows, and QA contracts remain intact. Existing frontend-related documents are retained only as requirements/design references and must not be interpreted as proof that a frontend is currently implemented.

## Backend architecture

The Kotlin/Spring Boot backend remains the sole business authority. Supabase supplies managed PostgreSQL and private object storage. Firebase Cloud Messaging is integrated behind a backend-owned notification abstraction. Clients created later must call the backend APIs rather than directly mutating domain tables.

## Authoritative documents

1. `docs/product/DECISIONS.md`
2. `docs/product/PRD.md`
3. flow contracts under `docs/flows/`
4. `docs/sprints/SPRINT_PLAN.md`
5. tests and implementation

When documents and implementation disagree, the decision log and PRD remain authoritative unless explicitly superseded.

## Verification

Use Java 21.

```bash
./scripts/verify.sh
```

The verification command performs the repository secret scan and the complete backend Gradle check. Frontend lint, TypeScript, Expo, Next.js, pnpm, and frontend dependency-audit gates are intentionally absent until a new frontend baseline is created.

## Frontend reset boundary

Removed implementation surfaces:

- Customer Expo app
- Merchant Expo app
- Captain Expo app
- Admin Next.js app
- shared TypeScript client packages/design tokens/mobile notification client code
- Node/pnpm/Expo/Next.js frontend build configuration and dependency lockfile

Product flows, requirements, and backend contracts remain available to guide the next frontend implementation.
# Dusky
