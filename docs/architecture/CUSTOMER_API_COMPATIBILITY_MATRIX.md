# Customer API Compatibility Matrix — MyPetNew (T1)

This document provides a comprehensive inventory of all Customer application HTTP contracts in `apps/customer-app` evaluated against the canonical `MyPetNew` Spring Boot modular monolith backend (`in.mypetnew`).

---

## 1. Summary of Endpoint Compatibility

| Capability | Method | Client Endpoint Path | Canonical MyPetNew Endpoint | Status | Owning Ticket |
|---|---|---|---|---|---|
| OTP Issue | POST | `/api/v1/auth/otp/issue` | `/api/v1/auth/otp/issue` | **MATCH** | T1 |
| OTP Verify | POST | `/api/v1/auth/otp/verify` | `/api/v1/auth/otp/verify` | **MATCH** | T1 |
| Session Rotate | POST | `/api/v1/auth/session/rotate` | `/api/v1/auth/session/rotate` | **MATCH** | T1 |
| Session Logout | POST | `/api/v1/auth/session/logout` | `/api/v1/auth/session/logout` | **MATCH** | T1 |
| Public Catalog Listings | GET | `/api/v1/public/catalog` | `/api/v1/public/catalog` | **MATCH** | T1 |
| Legacy Catalog Offerings | GET | `/api/v1/catalog/offerings` | `/api/v1/public/catalog` | **MISMATCH** | T2 |
| Legacy Provider Profile | GET | `/api/v1/providers/{id}` | N/A (Embedded in catalog/listings) | **LEGACY_ONLY** | T2 |
| Pickup Quote Creation | POST | `/api/v1/checkout/quote` | `/api/v1/customer/quotes/pickup` | **MISMATCH** | T2 |
| Product Checkout Order | POST | `/api/v1/orders` | `/api/v1/customer/orders` | **MISMATCH** | T2 |
| Customer Order Tracking | GET | `/api/v1/orders/customer/{id}/tracking` | N/A (Sprint 1 scope: Merchant order API) | **DEFERRED** | T2 |
| Order Detail | GET | `/api/v1/orders/{orderId}` | N/A (Sprint 1 scope: Merchant GET order) | **DEFERRED** | T2 |
| Order Cancellation | POST | `/api/v1/orders/{orderId}/cancel` | N/A | **DEFERRED** | T2 |
| Reorder Revalidation | POST | `/api/v1/orders/{orderId}/reorder` | N/A | **DEFERRED** | T2 |
| POS Association Challenge | POST | `/api/v1/customer/pos-association-challenges` | `/api/v1/customer/pos-association-challenges` | **MATCH** | T1 |
| Customer Loyalty Balance | GET | `/api/v1/customer/loyalty` | `/api/v1/customer/loyalty/{organizationId}` | **MATCH** | T1 |
| Legacy Loyalty Progress | GET | `/api/v1/loyalty/progress` | `/api/v1/customer/loyalty/{organizationId}` | **LEGACY_ONLY** | T2 |
| Customer Pet Management | GET/POST | `/api/v1/pets` | N/A (Backend pet service missing) | **MISSING** | T3 |
| Device Push Registration | POST | `/api/v1/notifications/push-tokens` | `/api/v1/devices/registrations` | **MISMATCH** | T5 |
| Notification Inbox | GET | `/api/v1/notifications` | `/api/v1/notifications` | **MATCH** | T1 |
| Appointments (Slots/Hold) | GET/POST | `/api/v1/appointments/*` | N/A (Sprint 2+) | **DEFERRED** | T5 |
| Medical Documents | GET/POST | `/api/v1/medical-documents/*` | N/A (Sprint 2+) | **DEFERRED** | T5 |
| Customer Support Cases | GET/POST | `/api/v1/support/cases` | N/A (Sprint 2+) | **DEFERRED** | T5 |
| Chat Threading | GET/POST | `/api/v1/chat/*` | N/A (Sprint 2+) | **DEFERRED** | T5 |
| Cashfree Payments | POST | `/api/v1/payments/*` | N/A (Sprint 2+) | **DEFERRED** | T5 |

---

## 2. Contract Inventory Details

### 2.1 Identity & Authentication (`IdentityController.kt`)

- **Service File**: `apps/customer-app/src/auth/otp-auth.ts`, `src/context/AuthContext.tsx`
- **Capability**: Customer Phone OTP Authentication & Session Lifecycle
- **Method & Path**: 
  - `POST /api/v1/auth/otp/issue` — Request OTP payload: `{ phoneNumber: string }`
  - `POST /api/v1/auth/otp/verify` — Verify OTP payload: `{ phoneNumber: string, otp: string }`
  - `POST /api/v1/auth/session/rotate` — Refresh token payload: `{ refreshToken: string }`
  - `POST /api/v1/auth/session/logout` — Header `Authorization: Bearer <accessToken>`
- **Auth Requirement**: Public for issue/verify/rotate; Bearer token for logout.
- **Header Standard**: `Content-Type: application/json`, `Accept: application/json`
- **Canonical MyPetNew Endpoint**: Matched 1-to-1 in `IdentityController.kt`.
- **Status**: **MATCH** (T1 Normalized)

---

### 2.2 Public Catalog & Storefront (`PublicCatalogController.kt`)

- **Service File**: `apps/customer-app/src/services/customer-catalog.ts`
- **Capability**: Browse public catalog offerings and prices
- **Method & Path**: `GET /api/v1/public/catalog?page=0&pageSize=20`
- **Canonical Response DTO**:
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
- **Legacy Mismatch**: Legacy client expected `/api/v1/catalog/offerings` and float rupees (`price: 250.00`). `PublicListingSummary` provides integer paise (`sellingPricePaise: 25000`).
- **Status**: **MATCH** for public catalog endpoint convention; full frontend component DTO mapping owned by **T2**.

---

### 2.3 Pickup Quote & Checkout Order (`SprintOneControllers.kt`)

- **Service File**: `apps/customer-app/src/services/customer-orders.ts`
- **Capability**: Merchant pickup quote calculation and order checkout execution
- **Canonical Quote Contract**:
  - `POST /api/v1/customer/quotes/pickup`
  - Auth: `Role.CUSTOMER`
  - Request DTO:
    ```json
    {
      "outletId": "uuid",
      "lines": [
        { "listingId": "uuid", "quantity": 1 }
      ]
    }
    ```
  - Response DTO: `Quote(id, customerId, outletId, lines, pricing(subtotalPaise, grandTotalPaise), cartSignature, expiresAt)`
- **Canonical Order Checkout Contract**:
  - `POST /api/v1/customer/orders`
  - Auth: `Role.CUSTOMER`
  - Mandatory Header: `Idempotency-Key: <unique-key>` (Standard casing, required by Spring `@RequestHeader("Idempotency-Key")`)
  - Request DTO:
    ```json
    {
      "quoteId": "uuid",
      "cartSignature": "string"
    }
    ```
  - Response DTO: `ProductOrder(id, customerId, outletId, status, totalAmountPaise, placedAt)`
- **Legacy Mismatch**: Legacy client sent `POST /api/v1/checkout/quote` and `POST /api/v1/orders` with `X-Idempotency-Key` and unstructured cart items.
- **Status**: **MISMATCH** — Documented for canonical migration in **T2**.

---

### 2.4 POS Association Challenge (`SprintOneControllers.kt`)

- **Service File**: `apps/customer-app/src/services/customer-orders.ts` (or POS challenge client)
- **Capability**: Initiate customer verification challenge for merchant POS loyalty award
- **Method & Path**: `POST /api/v1/customer/pos-association-challenges`
- **Auth**: `Role.CUSTOMER`
- **Headers**: `Idempotency-Key: <key>`
- **Request DTO**: `{ "organizationId": "uuid", "outletId": "uuid" }`
- **Canonical Endpoint**: Matched 1-to-1 in `SprintOneControllers.kt`.
- **Status**: **MATCH** (T1 Normalized)

---

### 2.5 Loyalty Balance (`SprintOneControllers.kt`)

- **Service File**: `apps/customer-app/src/services/loyalty.ts`
- **Capability**: Read merchant organization loyalty star balance for customer
- **Method & Path**: `GET /api/v1/customer/loyalty/{organizationId}`
- **Auth**: `Role.CUSTOMER`
- **Response DTO**: `{ "organizationId": "uuid", "availableStars": 5, "rewards": 1 }`
- **Normalization**: Added `fetchCustomerLoyaltyBalance(organizationId, accessToken)` targeting `/api/v1/customer/loyalty/${organizationId}`.
- **Status**: **MATCH** (T1 Normalized)

---

### 2.6 Device Push Notification Registration (`NotificationControllers.kt`)

- **Service File**: `apps/customer-app/src/hooks/usePushNotifications.ts`
- **Capability**: Register customer device notification token
- **Method & Path**: `POST /api/v1/devices/registrations`
- **Auth**: `Role.CUSTOMER`
- **Canonical Request DTO**:
  ```json
  {
    "appKind": "CUSTOMER",
    "environment": "PRODUCTION",
    "installationId": "uuid",
    "platform": "ANDROID",
    "nativeToken": "fcm-token-string",
    "permissionState": "GRANTED"
  }
  ```
- **Legacy Mismatch**: Legacy client called `/api/v1/notifications/push-tokens` with `{ expoPushToken, appRole }`.
- **Status**: **MISMATCH** — Documented for full hook migration in **T5**.

---

### 2.7 Customer Pets (`customer-pets.ts`)

- **Service File**: `apps/customer-app/src/services/customer-pets.ts`
- **Capability**: Pet profile list and creation (`GET|POST /api/v1/pets`)
- **Backend Status**: Backend pet management service is missing in Sprint 1 baseline.
- **Status**: **MISSING** — Owned by ticket **T3**.

---

### 2.8 Obsolete Microservice Tests (Legacy Test Suite)

- **Test Files**:
  - `src/__tests__/customer-journeys-e2e.test.ts`
  - `src/__tests__/recurring-orders-contract.test.ts`
  - `src/__tests__/medical-support-contract.test.ts`
- **Description**: These tests contain assertions attempting to read legacy Kotlin microservice files (`com/pawsnearme`).
- **T1 Action**: Preserved intact per specification F ("Do not delete or weaken them in T1").
- **Status**: **DEFERRED** — Test suite migration owned by **T4**.

---

## 3. Normalized Conventions Applied in T1

1. **Authorization Header**: Standardized to `Authorization: Bearer <token>` across `api-client.ts` and all HTTP service functions.
2. **Idempotency-Key Header**: Standardized to `Idempotency-Key` (exact casing matching Spring Boot `@RequestHeader("Idempotency-Key")`) rather than non-standard `X-Idempotency-Key`.
3. **Error Response Parsing**: All API errors are parsed via `apiErrorFromResponse()`, extracting `code`, `message`, and `traceId` from backend `GlobalExceptionHandler` envelopes (`ApiErrorEnvelope`).
4. **JSON Headers**: Standardized `Accept: application/json` and `Content-Type: application/json` on JSON requests.
