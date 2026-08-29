# M7 — Offline Onboarding Reconciliation

Baseline: `main@430595b769de7d6f4745c25b496bff2982b241e1`

## Goal
Allow a Merchant to capture an unknown barcode and product metadata while offline, persist the draft across process death, and reconcile it on reconnect without duplicate canonical listings or lost metadata.

## Authority and invariants
- PostgreSQL/Spring Boot remains the only canonical catalog authority.
- SQLite stores `LOCAL_DRAFT` operational state, temp identities, durable media work, and dependency mappings only.
- Unsynced drafts and unfinalized media are never Customer-visible.
- Barcode identity is outlet-scoped and string-preserving; a barcode never implies ownership, price, stock, tax, or authenticity.
- Every replay is reauthorized using current Merchant membership/outlet state.
- One same-outlet barcode race converges to one canonical listing; conflicting material fields require explicit reconciliation.
- Product metadata acceptance and media upload/finalization are independent so media failure cannot discard an accepted listing.

## Implementation slices
1. Extend the M6 typed command envelope with `CATALOG_CREATE` schema v1 and receipt resolution.
2. Add partitioned SQLite tables/repositories for local catalog drafts, temp→canonical identity mappings, and durable media jobs.
3. Add backend create/reconcile response semantics: `CREATED`, `EXISTING_LISTING`, `CONFLICT`, with canonical listing identity in accepted receipts.
4. Retarget dependent local commands/media jobs only after a durable canonical mapping is stored.
5. Add process-death, duplicate-race, permission/outlet revocation, media retry, cleanup-retention, and Customer non-visibility evidence.

## Merge gate
`M7-DRAFT-001` may move from `PLANNED` to `ENFORCED` only when executable backend + Merchant tests exist, required exact-head CI is green, adversarial review has no unresolved material defect, and the merged `main` SHA is re-verified.
