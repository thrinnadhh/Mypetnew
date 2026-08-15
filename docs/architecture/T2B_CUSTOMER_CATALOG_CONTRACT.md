# T2B Customer Catalog Contract — MyPetNew

Status: **Authoritative for T2B implementation**

Version: **1.0**

Date: **2026-08-12**

Baseline: `main@e8de602939d1bf0290e68e6603e0d68f2148f7fb` (T2A merged)

Owning scope: Sprint 1 `S1-11` guest catalog/product detail/cart-boundary UI and the backend catalog projection required to make those screens truthful.

## 1. Purpose

T2B replaces the restored Customer app's legacy provider/catalog contracts with canonical MyPetNew public APIs. It must satisfy the Sprint 1/PRD discovery requirements without fabricating server state.

The restored Customer UI currently assumes data such as ratings, reviews, delivery ETAs, rich seller addresses, return policies, and synthetic multi-variant products. The Sprint 1 backend does not own those facts. T2B MUST NOT invent them.

T2B is split into two serial implementation slices:

1. **T2B1 — Canonical catalog projection and persistence**
2. **T2B2 — Customer live catalog/product/store/search migration**

Do not implement T2C quote/order work, T2F loyalty, T3 pets, Cashfree, recurring-order runtime, grooming/vet service discovery, delivery/captain behavior, reviews/ratings, or later-sprint functionality in T2B.

## 2. Source-of-truth rules

1. Spring Boot is the only domain API authority.
2. Supabase remains PostgreSQL/object-storage infrastructure; Customer must not read catalog tables directly.
3. All money remains integer paise in API/domain contracts.
4. Product availability is server-owned inventory state.
5. Medicine remains `VIEW_ONLY` and cannot enter cart/quote/order/POS.
6. Guest browsing remains unauthenticated.
7. Public APIs expose only ACTIVE outlets and active listings.
8. Zero-stock COMMERCE listings remain discoverable with `availableQuantity = 0`; the UI shows out-of-stock and blocks Add.
9. No client-derived rating, review count, delivery ETA, return policy, merchant address, opening hours, or verification claim may be presented as live backend data unless a canonical backend field exists.
10. Demo fixtures may remain rich when `allowDemoMode` is explicitly enabled, but demo fields must never leak into live mode.

## 3. T2B1 — Listing metadata required by Sprint 1

The current `Listing` domain is too thin for PRD `CUS-003`, `CUS-004`, and `CAT-002`. Extend the canonical merchant-owned listing with this bounded Sprint 1 merchandising subset:

- `category: String` — normalized lower-case slug, required for new data, existing rows migrate to `other`.
- `brand: String?`
- `description: String?`
- `petType: String?`
- `lifeStage: String?`
- `packLabel: String?`
- `sku: String?`
- `imageUrls: List<String>` — public catalog images only, maximum 5.
- `createdAt: Instant` — already exists in PostgreSQL; make it part of the domain projection.

Existing fields remain authoritative:

- `id`
- `organizationId`
- `outletId`
- barcode type/value
- `name`
- `kind`
- `commerceMode`
- `mrpPaise`
- `sellingPricePaise`

### 3.1 Validation

- `category`: `[a-z0-9][a-z0-9-]{0,79}`; default `other` only for backward compatibility/migrated rows.
- `brand`: trimmed, max 100 characters when present.
- `description`: trimmed, max 2,000 characters when present.
- `petType`, `lifeStage`: trimmed, max 40 characters each when present.
- `packLabel`, `sku`: trimmed, max 80 characters each when present.
- `imageUrls`: 0..5 unique HTTPS URLs, each max 2,048 characters; no `data:`, `file:`, private signed-document URL, or non-HTTPS scheme.
- Existing MRP/selling-price and medicine `VIEW_ONLY` invariants remain unchanged.
- The create-request fingerprint MUST include the new merchandising fields and normalized image list so an idempotency key cannot replay a different listing payload.

### 3.2 Persistence

Add a new Flyway migration after the current highest version (`V9`). Do not edit `V1` retroactively.

Recommended shape:

- add nullable/compatible merchandising columns to `mypet.catalog_listing`; `category` is non-null with migration-safe default `other`.
- add `mypet.catalog_listing_image(listing_id, position, image_url)` with ordered positions and referential integrity rather than storing comma-separated values.
- JDBC persistence must create/read/replay/find/list the complete `Listing` without losing metadata.
- In-memory and JDBC behavior must remain contract-equivalent.

## 4. T2B1 — Canonical public APIs

### 4.1 Public outlet discovery

Add canonical guest endpoints:

`GET /api/v1/public/outlets?page=0&pageSize=20&capability=PRODUCT_STORE&q=...`

`GET /api/v1/public/outlets/{outletId}`

Response summary:

```json
{
  "id": "uuid",
  "organizationId": "uuid",
  "name": "Happy Pets Tirupati",
  "capabilities": ["PRODUCT_STORE"],
  "pickupEnabled": true
}
```

Rules:

- only `ACTIVE` outlets are visible;
- optional capability filter is exact and server-side;
- `q` matches outlet name case-insensitively;
- pagination validation remains `page >= 0`, `1 <= pageSize <= 100`;
- no rating, distance, address, hours, delivery ETA, or service PIN list is fabricated into this DTO.

### 4.2 Public catalog list

Keep the canonical path:

`GET /api/v1/public/catalog`

Supported query parameters:

- `page` default 0
- `pageSize` default 20, max 100
- `q?`
- `outletId?`
- `kind?` (`PRODUCT` or `MEDICINE`)
- `category?`
- `brand?`
- `petType?`
- `lifeStage?`
- `availability?` (`ANY`, `IN_STOCK`, `OUT_OF_STOCK`)
- `sort?` (`NAME`, `PRICE_ASC`, `PRICE_DESC`, `NEWEST`)

Filtering and sorting MUST happen before pagination.

`q` searches listing name, brand, category, and outlet name case-insensitively.

Only active listings belonging to ACTIVE outlets are returned. Do not hide a valid COMMERCE listing solely because available stock is zero.

Canonical summary DTO:

```json
{
  "id": "uuid",
  "organizationId": "uuid",
  "outletId": "uuid",
  "outletName": "Happy Pets Tirupati",
  "name": "Royal Canin Maxi Adult",
  "kind": "PRODUCT",
  "category": "food",
  "brand": "Royal Canin",
  "petType": "DOG",
  "lifeStage": "ADULT",
  "packLabel": "3 kg",
  "mrpPaise": 249900,
  "sellingPricePaise": 219900,
  "currency": "INR",
  "commerceMode": "COMMERCE",
  "availableQuantity": 12,
  "pickupEnabled": true,
  "primaryImageUrl": "https://...",
  "createdAt": "2026-08-12T10:00:00Z"
}
```

Nullable merchandising fields are JSON `null`, not invented strings.

### 4.3 Public catalog detail

Add:

`GET /api/v1/public/catalog/{listingId}`

Return the same authority fields as the summary plus:

- `description`
- `sku`
- `imageUrls`

A missing/inactive listing or listing owned by a non-ACTIVE outlet returns the repository's canonical not-found envelope. A zero-stock active listing still returns successfully with `availableQuantity = 0`.

## 5. Variant rule for Sprint 1

A merchant barcode listing is one sellable pack/SKU in Sprint 1. T2B MUST NOT fabricate a multi-variant product group.

Customer mapping is therefore:

- one listing => one Customer product;
- `packLabel`/`sku` describe that listing;
- the UI may construct one local selection object for existing cart component compatibility, but it must correspond 1:1 to the listing ID and server price/availability;
- do not merge separate listing IDs into a synthetic product without a future canonical grouping model.

## 6. T2B2 — Customer service migration

### 6.1 Remove legacy runtime routes

Live Customer catalog/discovery must stop calling:

- `/api/v1/discovery/providers`
- `/api/v1/providers/{id}`
- `/api/v1/catalog/offerings`
- `/api/v1/catalog/offerings/{id}`
- `/api/v1/discovery/search`

No compatibility shim may silently fall back to those endpoints.

Use `apiClient`/canonical `ApiError` handling for the new public calls.

### 6.2 Customer catalog model

Live Customer models must preserve canonical paise fields. A rupee amount used for display is a formatting projection only.

Fields not supplied by the canonical API must be optional/absent in live models and conditionally hidden in UI. Do not fill them with strings such as:

- `Same-day delivery`
- `Verified local pet store`
- `Returns subject to seller policy`
- `0.0 ★`
- fake addresses/hours/contact numbers
- demo product/store photography presented as live merchant content

When an image is missing, render an explicit neutral product/store placeholder rather than a demo merchant/product image.

### 6.3 Category/catalog screen

- query canonical `category`, `brand`, availability and sort parameters server-side;
- support pagination/load-more without losing prior pages;
- show name, outlet, selling price, MRP when greater than selling price, stock status/quantity, pack label, and primary image when present;
- rating sort/chips are hidden in live mode because no canonical rating exists;
- Add is enabled only when `kind == PRODUCT`, `commerceMode == COMMERCE`, `availableQuantity > 0`, and `pickupEnabled == true`;
- `MEDICINE`/`VIEW_ONLY` cards remain browsable but cannot be added to cart.

### 6.4 Product detail

Load `/api/v1/public/catalog/{listingId}` directly.

Render only canonical facts:

- listing/product name;
- brand/category when present;
- outlet identity;
- MRP/selling price;
- pack/SKU when present;
- stock status;
- description/images when present;
- pickup eligibility;
- explicit medicine `VIEW_ONLY` restriction.

Hide rating/review, delivery ETA, return policy, ingredients/specifications/suitability unless backed by canonical fields. Do not use demo values in live mode.

### 6.5 Store profile

Load `/api/v1/public/outlets/{outletId}` plus paginated `/api/v1/public/catalog?outletId=...`.

Render only server-owned outlet name, active public capabilities, pickup eligibility, and the outlet's catalog. Hide address/hours/rating/delivery ETA until those become canonical backend fields.

### 6.6 Home and search

For Sprint 1 live mode:

- Home product-store sections use `/api/v1/public/outlets?capability=PRODUCT_STORE` rather than static fake nearby stores.
- Store cards must not show fake ratings/distances/ETAs.
- Product category navigation uses canonical category filters.
- Product/shop search uses `/api/v1/public/catalog?q=...` and `/api/v1/public/outlets?q=...`.
- Hospital/groomer/guide universal-search filters are not implemented by T2B; in live mode they must be removed/disabled rather than routed to `/api/v1/discovery/search`.
- Demo mode may retain richer demo discovery behavior when explicitly enabled.

## 7. Cart boundary in T2B

T2B does not implement the server quote (T2C), but it must stop treating invented catalog data as cart authority.

Cart entries created from live catalog must retain at least:

- canonical listing ID;
- outlet ID;
- canonical selling price in paise;
- canonical availability snapshot for immediate UI validation;
- commerce mode/kind.

The cart remains single-outlet. Cross-outlet conflict behavior must remain explicit. Final stock/price authority is T2C server quote.

## 8. Required backend tests

T2B1 must add/adjust tests proving:

1. new listing metadata validation and trimming;
2. image URL scheme/count/length validation;
3. create idempotency fingerprint covers metadata;
4. JDBC persistence round-trips all metadata/images;
5. Flyway migration exists and schema contract passes;
6. only ACTIVE outlets are public;
7. active zero-stock PRODUCT remains listed with quantity 0;
8. inactive/suspended outlet listings are not public;
9. `MEDICINE` remains `VIEW_ONLY` and publicly browsable;
10. public list filters/search/sort occur before pagination;
11. outlet filter never leaks another outlet;
12. detail endpoint returns 404 for unavailable/inactive resources;
13. public outlet endpoints expose only allowed fields;
14. no public DTO exposes raw barcode audit or private verification data.

## 9. Required Customer tests

T2B2 must add/adjust tests proving:

1. zero active legacy catalog/discovery runtime routes;
2. public catalog list exact path/query/DTO mapping;
3. public listing detail exact path/DTO mapping;
4. public outlet list/detail exact path/DTO mapping;
5. paise values remain canonical and display conversion is formatting only;
6. pagination/load-more behavior;
7. zero stock blocks Add but remains visible;
8. `VIEW_ONLY` medicine is visible and cannot enter cart;
9. no live fake rating/distance/ETA/address/hours/return-policy substitution;
10. missing image uses neutral placeholder, not demo merchant data;
11. category/search queries use canonical server filters;
12. live Home store section comes from public outlet API;
13. product/shop search no longer uses `/api/v1/discovery/search`;
14. demo mode remains isolated from live mode;
15. T4 deferred-capability guards and T2A auth/session tests remain green.

## 10. Verification gates

Backend:

```bash
./gradlew :backend:check --no-daemon --no-configuration-cache
```

Customer:

```bash
cd apps/customer-app
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
```

Repository searches:

```bash
rg "/api/v1/discovery/providers|/api/v1/providers/|/api/v1/catalog/offerings|/api/v1/discovery/search" apps/customer-app/src
rg "Same-day delivery|Verified local pet store|Returns and replacements are subject" apps/customer-app/src/services/customer-catalog.ts apps/customer-app/src/components/commerce apps/customer-app/src/screens
```

Any remaining legacy matches must be explicitly demo-only, test/spec text, or owned by a different deferred capability; runtime live catalog must have zero matches.

## 11. Implementation sequence

1. T2B1 backend/domain/schema/public API only.
2. GPT-5.6 Sol review + backend CI.
3. T2B2 Customer service/model/UI migration.
4. GPT-5.6 Sol review + Customer/backend CI.
5. PR to `main` only after both T2B slices are certified.

Do not start T2C until T2B is merged and the compatibility matrix reports canonical public catalog/outlet runtime usage.
