# P3B — Canonical Discovery Filter Contract

Baseline: `main` @ `256c206af4bdf77a42040508cd7652355c20547d` after P3A favourites.

Roadmap authority: `docs/architecture/CUSTOMER_PRODUCTION_10_PLAN_ROADMAP.md`, Plan 3.

## Objective

Complete the remaining low-risk public discovery query contract before broader Plan 3 UI consolidation. This slice adds only the two roadmap filters missing from current `main`: outlet `pincode` and catalog `commerceMode`.

## Public outlet contract

`GET /api/v1/public/outlets?capability=&pincode=&q=&page=&pageSize=`

- only `ACTIVE` outlets are visible;
- `capability` remains exact enum matching;
- optional `pincode` must be a normalized six-digit Indian PIN beginning with 1–9;
- when supplied, an outlet matches only when that PIN is present in its server-owned `servicePinCodes`;
- `servicePinCodes` themselves remain excluded from the public DTO;
- query filtering occurs before deterministic pagination;
- invalid PIN returns `PIN_CODE_INVALID`.

This is a discovery filter only. It does not replace `GET /api/v1/public/outlets/{outletId}/serviceability`, which remains the authoritative fulfilment serviceability check.

## Public catalog contract

`GET /api/v1/public/catalog?...&commerceMode=COMMERCE|VIEW_ONLY&...`

- optional `commerceMode` is a server-side filter over canonical listing mode;
- invalid enum values fail through the standard validation envelope;
- filtering occurs before the existing deterministic sort and pagination;
- medicine remains discoverable as `VIEW_ONLY` where requested, but commerce product discovery explicitly requests `COMMERCE` so view-only medicine cannot be accidentally treated as purchasable inventory.

## Customer client

`PublicOutletQuery` accepts optional `pincode` and passes it to the canonical public outlet endpoint.

`PublicCatalogQuery` accepts optional `commerceMode` and passes it to the canonical public catalog endpoint.

`fetchCommerceProducts()` requests `commerceMode=COMMERCE` in live mode. Direct listing detail and provider profile reads remain capable of displaying `VIEW_ONLY` medicine without creating purchase authority.

## Security and privacy boundaries

- no authenticated Customer identity is accepted or required by these public discovery filters;
- no merchant service PIN list is returned to clients;
- no client filter can alter listing `commerceMode`;
- cart/order services remain responsible for rejecting `VIEW_ONLY` listings even if a client bypasses discovery filtering;
- no location coordinates or new personal data are introduced.

## Verification

Backend API coverage must prove:

- exact PIN filtering across active outlets;
- non-matching PIN returns no outlet;
- invalid PIN fails closed;
- service PIN arrays remain absent from public DTOs;
- `COMMERCE` and `VIEW_ONLY` catalog filters separate product and medicine listings;
- invalid `commerceMode` fails through canonical validation.

Customer contract coverage must prove:

- `pincode` is encoded into `/api/v1/public/outlets`;
- `commerceMode` is encoded into `/api/v1/public/catalog`;
- live commerce discovery always requests `COMMERCE`.

No DB migration, search microservice, trigram/full-text index, delivery dispatch, payment, recurring order, grooming or veterinary runtime is part of P3B.
