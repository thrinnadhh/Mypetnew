# T2B2 — Customer Catalog Runtime Contract

Status: AUTHORITATIVE for T2B2 implementation on `trial/t2b-customer-catalog`.

T2B1 has already established the canonical Sprint-1 backend catalog/outlet projection. T2B2 migrates the restored Customer runtime to that projection. T2B2 MUST NOT redesign the backend catalog model or start quote/order/loyalty/pets work.

## 1. Canonical live endpoints

Customer live catalog/discovery MUST use only:

- `GET /api/v1/public/outlets`
- `GET /api/v1/public/outlets/{outletId}`
- `GET /api/v1/public/catalog`
- `GET /api/v1/public/catalog/{listingId}`

The following legacy MyPet routes are forbidden in active Sprint-1 Customer catalog/discovery code after T2B2:

- `/api/v1/discovery/providers`
- `/api/v1/providers/{id}`
- `/api/v1/catalog/offerings`
- `/api/v1/catalog/offerings/{id}`

Public catalog calls are guest-readable and MUST use the shared `apiClient` so ApiError/error handling remains canonical. Do not add manual bearer headers for these public reads.

## 2. Backend DTO authority

### Public outlet

The Customer may trust only:

- `id`
- `organizationId`
- `name`
- `capabilities`
- `pickupEnabled`

The public outlet DTO does NOT authorize Customer UI to invent or infer:

- distance
- city
- address
- pincode
- opening hours
- contact phone
- rating
- review count
- delivery ETA
- merchant description/tagline
- service PIN-code list
- verification documents

Only ACTIVE outlets are returned by the backend. Customer UI may say the store is available/active, but MUST NOT label it "Verified Partner" unless a future canonical public verification field exists.

### Public listing summary

The Customer may trust:

- `id`
- `organizationId`
- `outletId`
- `outletName`
- `name`
- `kind`
- `category`
- `brand`
- `petType`
- `lifeStage`
- `packLabel`
- `mrpPaise`
- `sellingPricePaise`
- `currency`
- `commerceMode`
- `availableQuantity`
- `pickupEnabled`
- `primaryImageUrl`
- `createdAt`

### Public listing detail

Detail adds:

- `description`
- `sku`
- `imageUrls`

No Customer adapter may synthesize ratings, reviews, delivery promises, return policies, seller addresses, or extra variants from these fields.

## 3. Money

Backend money is integer paise and server-authoritative.

Customer view-model conversion:

- `price = sellingPricePaise / 100`
- `originalPrice = mrpPaise > sellingPricePaise ? mrpPaise / 100 : undefined`

Do not derive price from UI state, stale cart price, MRP discount assumptions, or demo fixtures in live mode.

## 4. One listing = one sellable SKU/pack

T2B1 intentionally models one Listing as one sellable pack/SKU.

T2B2 MUST NOT rebuild fake multi-variant groups.

Because the current CartContext requires a ProductVariant object, live catalog mapping may create exactly one adapter variant with:

- `id = listing.id`
- `name = packLabel ?? sku ?? listing.name`
- `price = selling price in rupees`
- `originalPrice = MRP in rupees when MRP > selling price`
- `stockCount = availableQuantity`
- `inStock = availableQuantity > 0`

This adapter object is a compatibility view for the single listing, not a second domain identity and not a multi-variant grouping.

Product-detail UI MUST NOT show a "Select Pack / Size" section when only this one listing exists.

## 5. Commerce eligibility

A live listing may be added to cart only when ALL are true:

- `kind == PRODUCT`
- `commerceMode == COMMERCE`
- `availableQuantity > 0`
- `pickupEnabled == true`

A MEDICINE is always VIEW_ONLY for Sprint 1.

For MEDICINE/VIEW_ONLY:

- it remains browsable
- product detail remains accessible
- no Add button
- no quantity stepper
- show neutral text such as `View only — online purchase is unavailable`

For a COMMERCE product with zero stock:

- show `Out of stock`
- disable Add

For a COMMERCE product at an outlet without pickup enabled:

- do not allow Add
- show neutral pickup-unavailable state

CartContext MUST enforce the same eligibility so UI bypass/stale callers cannot add a VIEW_ONLY or pickup-disabled listing.

T2C remains responsible for server quote revalidation.

## 6. Fulfilment wording

Sprint 1 is `STORE_PICKUP` + `PAY_ON_FULFILMENT`.

Live mode MUST NOT display unsupported claims such as:

- `Same-day delivery`
- `15-25 mins`
- `20-30 mins`
- `Nearby`
- `x km away`
- `Delivery:`

unless a future canonical backend contract supplies those values.

Approved live wording examples:

- `Available pet stores`
- `Store pickup available`
- `Pickup unavailable`
- `Live stock and prices`

Do not claim a store belongs to the currently selected city because the current public outlet DTO does not expose city/serviceability filtering.

## 7. Optional merchandising fields

The restored demo view model contains fields richer than the live backend.

For live mode, these fields MUST become optional or be represented by a new live-safe view model:

- brand
- rating
- reviewCount
- deliveryTime
- imageUrl
- description
- seller address
- deliveryEstimate
- returnPolicy
- openingHours
- contactPhone
- store tagline
- city/pincode
- hero image

UI rules:

- absent rating => hide rating badge/sort
- absent delivery ETA => hide ETA badge/text
- absent address => hide address row
- absent hours => hide hours row
- absent return policy => hide return policy section
- absent description => hide description section or show only a neutral `No description provided` label; do not manufacture copy
- absent image => render a neutral local placeholder/icon, not a category-specific demo photograph pretending to be the product

Demo mode may continue to use rich demo fixtures and demo imagery when `appConfig.allowDemoMode` is explicitly true.

## 8. Product metadata that MAY be derived from canonical fields

The Customer may derive presentation-only fields from real backend metadata:

- `inStock = availableQuantity > 0`
- `isNewArrival` from canonical `createdAt` using a documented client threshold, or by using backend `NEWEST` ordering
- specifications from canonical `category`, `brand`, `petType`, `lifeStage`, `packLabel`, `sku`, and availability
- suitability tags only from canonical `petType` and `lifeStage`

Do not derive unsupported food form (`DRY`/`WET`), breed size, ingredients, rating, returns, or delivery claims.

## 9. Canonical Customer service layer

Replace legacy `BackendOffering` / `PublicProvider` runtime contracts with typed DTOs matching T2B1 exactly.

Recommended service API:

- `fetchPublicOutlets(query)`
- `fetchPublicOutlet(outletId)`
- `fetchCatalogPage(query)`
- `fetchCatalogListing(listingId)`
- `fetchCommerceProduct(listingId)`
- `fetchCommerceProducts(query)`
- `fetchShopProfile(outletId)`

All live fetches use `apiClient`.

No local catch should flatten canonical ApiError into `new Error('CATALOG_500')`.

## 10. Pagination

Backend catalog/outlet APIs are paginated.

T2B2 MUST NOT assume a single response is an unbounded array.

Use the backend `PageResponse` contract:

- `items`
- `page`
- `pageSize`
- `hasNext`

For existing screens that still consume an array, either:

1. implement proper incremental page loading in the screen, or
2. use a clearly named helper that follows `hasNext` until complete for the bounded screen use case.

Do not silently truncate to the first page.

Prefer server query parameters for category/search/filter/sort where the UI exposes those controls.

## 11. Store discovery mapping

Commerce discovery must use:

`GET /api/v1/public/outlets?capability=PRODUCT_STORE`

Do not pass latitude/longitude/radius because the canonical endpoint does not support them.

ProviderSummary should be replaced or narrowed for live store discovery. Do not fill `distanceKm=0`, `rating=0`, or `description=''` merely to satisfy the old interface and then render those values as facts.

Store card live content should be limited to truthful information such as:

- store name
- product-store capability
- pickup available/unavailable
- Explore action

## 12. Category/search/sort behavior

The backend supports:

- `q`
- `outletId`
- `kind`
- `category`
- `brand`
- `petType`
- `lifeStage`
- `availability = ANY | IN_STOCK | OUT_OF_STOCK`
- `sort = NAME | PRICE_ASC | PRICE_DESC | NEWEST`

Customer controls should map to these values where possible.

Do NOT show a `Top rated` sort in live mode because rating is not canonical.

Food `DRY/WET` filters must not appear in live mode because food form is not in the backend projection.

Life-stage filters may appear only when backed by actual `lifeStage` metadata.

## 13. Category routes

Existing product categories such as `food`, `furniture`, `toys`, `travel`, `treats`, and `waste` may map directly to the backend category slug.

`new-arrivals` may use `sort=NEWEST`; do not invent a backend category named `new-arrivals`.

Service categories such as grooming/hospitals/vaccinations are NOT product-catalog T2B2 work. Do not route them through the product catalog as fake products.

## 14. Store profile

Live shop profile uses:

- public outlet detail
- public catalog filtered by `outletId`

Live store profile may show:

- name
- pickup state
- capabilities
- categories derived from returned listings
- real listings

It must hide unsupported rating/reviews/address/hours/contact/delivery/tagline fields.

LoyaltyCard is T2F-owned. T2B2 must not redesign loyalty; preserve it only if its existing rendering does not require fabricated catalog/store metadata.

## 15. Product detail

Live product detail uses `GET /api/v1/public/catalog/{listingId}`.

Show only truthful fields:

- image(s) when provided
- brand when provided
- name
- store name
- selling price
- MRP when greater than selling price
- stock quantity/state
- pack label when provided
- description when provided
- canonical specifications
- store navigation
- pickup state
- medicine/view-only state

Hide:

- rating/reviews
- delivery ETA
- seller address
- invented return policy
- ingredients not provided by backend
- unsupported suitability tags
- fake variant selector

## 16. Favourites and cart revalidation

Any favourite/product reload that already calls `fetchCommerceProduct` or `fetchShopProfile` should automatically receive the canonical adapter after T2B2.

Do not start a favourites redesign.

Cart revalidation may use canonical listing detail to refresh:

- price
- stock
- commerce mode
- pickup eligibility

but T2C remains responsible for canonical server quote creation.

## 17. Demo/live separation

`appConfig.allowDemoMode == true` may retain existing sample providers/products and rich demo-only fields.

`appConfig.allowDemoMode == false` MUST NOT:

- read SAMPLE_PRODUCTS as fallback data
- use DEMO_PROVIDER_FIXTURES as fallback data
- manufacture demo ratings/ETA/address/policy
- silently fall back to demo data after an API failure

Live API errors must surface through the existing loading/offline/error states.

## 18. Error handling

Use canonical `ApiError` from the shared client.

Preserve offline detection where supported, but do not replace stable server codes/status/traceId with generic catalog strings.

404 listing/outlet => unavailable state.

Other failures => existing error/retry state.

No fake success path after error.

## 19. Compatibility matrix

Only after active Customer catalog/discovery routes are migrated and tests prove legacy routes are absent may `CUSTOMER_API_COMPATIBILITY_MATRIX.md` mark the public catalog/outlet Customer runtime as MATCH.

Do not mark quote/order/loyalty/pets as MATCH as part of T2B2.

## 20. Required active-path grep gate

After T2B2, active Customer catalog/discovery source MUST have zero references to:

- `/api/v1/discovery/providers`
- `/api/v1/providers/`
- `/api/v1/catalog/offerings`

Tests/docs may mention legacy routes only to assert they are forbidden/removed.

## 21. Required tests

At minimum cover:

1. canonical outlet list path/query
2. canonical outlet detail path
3. canonical catalog list path/query
4. canonical catalog detail path
5. paise -> rupee mapping
6. MRP mapping
7. nullable brand/image/description handled without fake values
8. one listing -> exactly one compatibility variant with listing ID
9. zero-stock product cannot add
10. VIEW_ONLY medicine cannot add
11. pickup-disabled product cannot add
12. live store card does not show rating/distance/ETA
13. live product card/detail hides rating/ETA/policy/address when absent
14. product detail uses canonical listing detail
15. shop profile uses canonical outlet + outlet-filtered catalog
16. pagination does not truncate silently
17. server category/search/filter/sort query mapping
18. Top-rated / DRY-WET controls hidden or removed in live mode
19. guest catalog works without authentication requirement
20. demo mode remains explicitly isolated
21. legacy catalog/provider routes absent from active source
22. Customer typecheck/lint/Jest remain green
23. backend CI remains green

## 22. Out of scope

Do not start:

- T2C quote
- T2D checkout/order
- T2E order detail/tracking
- T2F loyalty
- T2G integration gate
- T3 pets
- delivery/captain
- serviceability redesign
- map/distance backend
- ratings/reviews backend
- returns backend
- service/grooming/vet discovery redesign
- recurring orders
- Cashfree

## 23. Acceptance gate

T2B2 passes only when:

- live Customer commerce discovery uses canonical public outlets
- live Customer catalog/product/store flows use canonical public catalog/outlet APIs
- no active legacy MyPet catalog/discovery route remains
- no unsupported live marketplace facts are fabricated
- medicine/view-only and pickup eligibility are enforced in UI and CartContext
- live list/detail pagination/contracts are tested
- Customer typecheck/lint/Jest are green
- backend verification remains green
- GPT-5.6 Sol final audit finds no critical/high catalog runtime defect
