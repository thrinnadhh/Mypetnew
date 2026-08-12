# Customer API Compatibility Matrix — MyPetNew (T1)

This document presents the authoritative inventory of Customer HTTP contracts in `apps/customer-app` evaluated against the canonical `MyPetNew` Spring Boot modular monolith backend (`in.mypetnew`).

---

## 1. Executive Endpoint Inventory

| Capability | Method | Client Endpoint Path | Canonical MyPetNew Endpoint | Status | Owning Ticket |
|---|---|---|---|---|---|
| OTP Challenge Request | POST | `supabase.auth.signInWithOtp` (SDK) | `/api/v1/auth/otp/request` | **MISMATCH** | T2 |
| OTP Verification | POST | `supabase.auth.verifyOtp` (SDK) | `/api/v1/auth/otp/verify` | **MISMATCH** | T2 |
| Session Refresh | POST | `supabase.auth.getSession` (SDK) | `/api/v1/auth/sessions/refresh` | **MISMATCH** | T2 |
| Session Logout | DELETE | `supabase.auth.signOut` (SDK) | `/api/v1/auth/sessions/current` | **MISMATCH** | T2 |
| Public Catalog Listings | GET | Legacy provider/catalog routes (Canonical `/api/v1/public/catalog` not yet consumed) | `/api/v1/public/catalog` | **MISMATCH** | T2 |
| Legacy Provider Discovery | GET | `/api/v1/discovery/providers` | N/A (Replaced by `/api/v1/public/catalog`) | **LEGACY_ONLY** | T2 |
| Legacy Provider Profile | GET | `/api/v1/providers/{id}` | N/A (Embedded in catalog/listings) | **LEGACY_ONLY** | T2 |
| Legacy Catalog Offerings | GET | `/api/v1/catalog/offerings` | `/api/v1/public/catalog` | **LEGACY_ONLY** | T2 |
| Pickup Quote Creation | POST | `/api/v1/checkout/quote` | `/api/v1/customer/quotes/pickup` | **MISMATCH** | T2 |
| Product Checkout Order | POST | `/api/v1/orders` | `/api/v1/customer/orders` | **MISMATCH** | T2 |
| POS Association Challenge | POST | `/api/v1/customer/pos-association-challenges` | `/api/v1/customer/pos-association-challenges` | **MATCH** | T1 |
| Customer Loyalty Balance | GET | `/api/v1/customer/loyalty/{organizationId}` | `/api/v1/customer/loyalty/{organizationId}` | **MISMATCH** (Canonical helper added; UI runtime migration pending) | T2 |
| Legacy Loyalty Progress | GET | `/api/v1/loyalty/progress` | `/api/v1/customer/loyalty/{organizationId}` | **LEGACY_ONLY** | T2 |
| Customer Pet Management | GET/POST | `/api/v1/pets` | N/A (Backend pet service missing) | **MISSING** | T3 |
| Device Push Registration | POST | `/api/v1/notifications/push-tokens` | `/api/v1/devices/registrations` | **MISMATCH** | T5 |
| Notification Inbox | GET | `/api/v1/notifications` | `/api/v1/notifications` | **MATCH** | T1 |
| Obsolete Microservice Tests | N/A | Local test assertions | N/A (Legacy `com.pawsnearme` paths) | **DEFERRED** | T4 |

---

## 2. Detailed Contract Analysis

### 2.1 Customer Authentication & Session Management (`IdentityController.kt`)

- **Status**: **MISMATCH**
- **Current Client Mechanism**: `apps/customer-app/src/auth/otp-auth.ts` and `src/context/AuthContext.tsx` directly execute Supabase Auth SDK operations (`supabase.auth.signInWithOtp`, `verifyOtp`, `getSession`, `onAuthStateChange`, `signOut`).
- **Canonical MyPetNew Endpoints (`IdentityController.kt`)**:
  - `POST /api/v1/auth/otp/request`
    - Request DTO: `OtpRequestBody(mobile: String, purpose: OtpPurpose.LOGIN, deviceId: String)`
    - Response DTO: `OtpChallengeResponse(challengeId: UUID, expiresAt: Instant, retryAfterSeconds: Long)`
  - `POST /api/v1/auth/otp/verify`
    - Request DTO: `OtpVerifyBody(challengeId: UUID, mobile: String, purpose: OtpPurpose.LOGIN, code: String)`
    - Response DTO: `OtpSessionResponse(accessToken: String, refreshToken: String, tokenType: "Bearer", accessTokenExpiresAt: Instant, refreshTokenExpiresAt: Instant, role: Role.CUSTOMER)`
  - `POST /api/v1/auth/sessions/refresh`
    - Request DTO: `RefreshSessionBody(refreshToken: String)`
    - Response DTO: `OtpSessionResponse`
  - `DELETE /api/v1/auth/sessions/current`
    - Header: `Authorization: Bearer <accessToken>`
- **Session Model Difference**: Per Decision `D-024`, Supabase Auth is not an authority for business domain flows. The repository uses `InMemorySessionStore` only under `test` and `development` profiles, while `JdbcSessionStore` is the non-test/non-development implementation backed by PostgreSQL. Canonical `MyPetNew` relies on Spring Boot JWT Bearer tokens + `SessionStore` + session rotation.
- **Owning Follow-up Ticket**: **T2** (Full Auth & Session Migration).

---

### 2.2 Public Catalog & Discovery (`PublicCatalogController.kt`)

- **Status**: **MISMATCH**
- **Current Client Mechanism**: Live non-demo flows in `customer-catalog.ts` and `provider-discovery.ts` issue HTTP GET requests to:
  - `/api/v1/discovery/providers`
  - `/api/v1/providers/{id}`
  - `/api/v1/catalog/offerings`
  - `/api/v1/catalog/offerings/{id}`
- **Canonical MyPetNew Endpoint (`PublicCatalogController.kt`)**:
  - `GET /api/v1/public/catalog?page=0&pageSize=20`
  - Response DTO: `PageResponse<PublicListingSummary>`
    ```json
    {
      "items": [
        {
          "id": "uuid-string",
          "outletId": "uuid-string",
          "name": "Offering Name",
          "sellingPricePaise": 25000,
          "currency": "INR",
          "commerceMode": "COMMERCE"
        }
      ],
      "page": 0,
      "pageSize": 20,
      "hasNext": false
    }
  ```
- **DTO & Path Differences**: Legacy client expected separate provider search/detail endpoints and individual offering objects with float `price` in rupees. `MyPetNew` consolidates public catalog browsing into `GET /api/v1/public/catalog` page responses with integer `sellingPricePaise`.
- **Owning Follow-up Ticket**: **T2** (Full Catalog DTO & UI Migration).

---

### 2.3 Pickup Quote & Checkout Order (`SprintOneControllers.kt`, `QuoteService.kt`, `OrderService.kt`)

- **Status**: **MISMATCH**
- **Current Client Mechanism**: `customer-orders.ts` calls `POST /api/v1/checkout/quote` and `POST /api/v1/orders`.
- **Canonical Pickup Quote Endpoint (`QuoteService.kt`, `SprintOneControllers.kt`)**:
  - `POST /api/v1/customer/quotes/pickup`
  - Request DTO: `PickupQuoteRequest(outletId: UUID, lines: List<OrderLineRequest(listingId: UUID, quantity: Int)>)`
  - Response DTO: `Quote`
    ```json
    {
      "id": "uuid",
      "customerId": "uuid",
      "outletId": "uuid",
      "lines": { "listingId": [1, 25000] },
      "cartSignature": "sha256-hex-string",
      "fulfilmentMode": "STORE_PICKUP",
      "paymentMethod": "PAY_ON_FULFILMENT",
      "pricing": {
        "itemSubtotalPaise": 25000,
        "itemDiscountPaise": 0,
        "couponDiscountPaise": 0,
        "loyaltyRewardPaise": 0,
        "taxPaise": 0,
        "platformFeePaise": 1000,
        "deliveryFeePaise": 0,
        "merchantCommissionPaise": 1000,
        "grandTotalPaise": 26000,
        "currency": "INR",
        "ruleVersion": "s1-v1"
      },
      "expiresAt": "2026-08-12T18:00:00Z"
    }
    ```
- **Canonical Product Checkout Order Endpoint (`OrderService.kt`, `SprintOneControllers.kt`)**:
  - `POST /api/v1/customer/orders`
  - Mandatory Header: `Idempotency-Key: <key>`
  - Request DTO: `CheckoutRequest(quoteId: UUID, cartSignature: String)`
  - Response DTO: `ProductOrder`
    ```json
    {
      "id": "uuid",
      "customerId": "uuid",
      "outletId": "uuid",
      "lines": { "listingId": 1 },
      "grandTotalPaise": 26000,
      "platformFeePaise": 1000,
      "merchantCommissionPaise": 1000,
      "paymentMethod": "PAY_ON_FULFILMENT",
      "status": "PLACED",
      "history": [
        {
          "status": "PLACED",
          "occurredAt": "2026-08-12T17:35:00Z",
          "commandKey": "key"
        }
      ]
    }
    ```
  - *Field Accuracy Verification*: Canonical `ProductOrder` contains `id`, `customerId`, `outletId`, `lines`, `grandTotalPaise`, `platformFeePaise`, `merchantCommissionPaise`, `paymentMethod`, `status`, and `history`. There is **no `totalAmountPaise` field** and **no top-level `placedAt` field** (`placedAt` timestamp lives inside `history`).
- **Owning Follow-up Ticket**: **T2** (Full Quote & Checkout Order Migration).

---

### 2.4 Customer Loyalty (`SprintOneControllers.kt`, `loyalty.ts`)

- **Status**: **MISMATCH** (Canonical helper added in T1; runtime UI caller migration pending in T2)
- **Canonical Endpoint**: `GET /api/v1/customer/loyalty/{organizationId}`
  - Auth: `Role.CUSTOMER`
  - Response DTO: `LoyaltyResponse(organizationId: UUID, availableStars: Int, rewards: Int)`
- **T1 Normalization**: `loyalty.ts` exports `fetchCustomerLoyaltyBalance(organizationId, accessToken)` using `apiErrorFromResponse()`.
- **Runtime Gap**: Active UI screens in `apps/customer-app` still call legacy functions (`fetchLoyaltyProgress`, `fetchCustomerWallet`). Full UI runtime caller migration belongs to **T2**. Legacy functions are retained for UI compatibility.

---

### 2.5 API Error Convention Normalization

- **Canonical Parser**: `apiErrorFromResponse()` in `contracts/api-error.ts` parses backend `ApiErrorEnvelope(code, message, traceId, fieldErrors, timestamp, path)` from `GlobalExceptionHandler.kt`.
- **Normalization Status**:
  - `api-client.ts` uses `apiErrorFromResponse()`.
  - `fetchCustomerLoyaltyBalance()` in `loyalty.ts` uses `apiErrorFromResponse()`, preserving `status`, `code`, `traceId`, and `fieldErrors`.
  - Legacy service functions (`customer-catalog.ts` `fetchJson`, `customer-orders.ts` `responseError`, `loyalty.ts` `apiError`) still use string fallbacks. These remaining service functions are documented as legacy mismatches to be updated alongside their respective ticket migrations (T2/T5).

---

## 3. Summary of Follow-Up Ticket Boundaries

- **T2**: Implement full client authentication migration to `IdentityController.kt`, remap public catalog browsing to `GET /api/v1/public/catalog`, implement canonical pickup quote & checkout order DTO lifecycle (`CheckoutRequest`, `quoteId`, `cartSignature`), and wire loyalty balance UI.
- **T3**: Implement backend Customer Pet domain service, Flyway migrations, and `/api/v1/pets` endpoints.
- **T4**: Migrate obsolete `com.pawsnearme` microservice source path tests to canonical `in.mypetnew` modular monolith tests.
- **T5**: Remap push device registration to `POST /api/v1/devices/registrations` (`RegisterDeviceRequest`).
