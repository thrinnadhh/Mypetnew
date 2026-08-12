# T2A Customer Auth & Session Architecture Contract — MyPetNew

Status: **Authoritative**
Version: **1.0**
Date: **2026-08-12**
Owning Component: **Customer App (`apps/customer-app`) & Backend Identity (`in.mypetnew.application.web.IdentityController`)**

---

## 1. Authority & Infrastructure Boundaries

1. **Backend Authority**: The Kotlin/Spring Boot modular monolith (`in.mypetnew`) is the **sole authentication and session authority** for Customer identity.
2. **Supabase Scope**: Supabase is strictly managed database (PostgreSQL) and object-storage infrastructure. Client applications **must not** invoke Supabase Auth (`supabase.auth.*`), decode bearer tokens, or create client-authored roles.
3. **Session Contract**:
    - `POST /api/v1/auth/otp/request`: Requests a mobile OTP challenge. Returns `{"challengeId": "UUID", "message": "String", "expiresAt": "ISO", "resendAfterSeconds": 30}`.
    - `POST /api/v1/auth/otp/verify`: Verifies the challenge code and issues a canonical Customer session response with `accountId` and `role`.
    - `POST /api/v1/auth/sessions/refresh`: Rotates the refresh token and issues a new access token for the authenticated `accountId`.
    - `DELETE /api/v1/auth/sessions/current`: Revokes the active session on the backend.

---

## 2. DTO Shapes & Server Role Authority

### OTP Challenge DTO
```json
{
  "challengeId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "message": "If the mobile number can receive messages, a verification code has been sent.",
  "expiresAt": "2026-08-12T19:05:00Z",
  "resendAfterSeconds": 30
}
```

### Session Response DTO
```json
{
  "accountId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
  "refreshToken": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "tokenType": "Bearer",
  "accessTokenExpiresAt": "2026-08-12T19:00:00Z",
  "refreshTokenExpiresAt": "2026-09-11T18:00:00Z",
  "role": "CUSTOMER"
}
```

**Server Role Authority**: For both OTP verify and refresh, the client strictly validates `response.role === 'CUSTOMER'`. Non-`CUSTOMER` roles (`MERCHANT`, `CAPTAIN`, `ADMIN`, or missing/unknown) are immediately rejected, clearing local session storage and never exposing authenticated state.

---

## 3. Verified Mobile Session Construction

- `verifyOtpCode` combines the server session response (`accountId`, tokens, expiration) with the verified mobile string sent in the challenge request into `CustomerAuthSession`.
- `CustomerAuthSession.mobile` is guaranteed to be a valid non-empty string before calling `setSession`/`savePersistedSession`.
- Token refresh retains the already persisted verified mobile string.

---

## 4. Installation Identifier Strategy

- **Format**: UUIDv4 generated using `expo-crypto`'s `randomUUID()`.
- **Properties**: Generated once per installation, stored securely, length <= 128 characters, zero hardware/advertising/push-token dependencies.

---

## 5. Session Storage & Refresh Strategy

- **Native (iOS/Android)**: `expo-secure-store` used for long-lived refresh credentials (`refreshToken`, `refreshTokenExpiresAt`, `accountId`, `mobile`, `role`). `accessToken` remains runtime-only.
- **Expo Web**: `window.sessionStorage` used for session state; `localStorage` strictly prohibited for refresh credentials.
- **Persistence-First Policy**: Restart state is validated and persisted before publishing authenticated state to UI subscribers. Storage failures reject session establishment and do not leave half-authenticated UI state.
- **Central Refresh Handling**: Single in-flight Promise coalesces concurrent `401` requests. Retries original request once on success. Never refreshes on `403`. Auth endpoints (including `DELETE /api/v1/auth/sessions/current`) bypass refresh. Discards in-flight refresh if user signs out during request (auth epoch guard).
