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
   - `POST /api/v1/auth/otp/request`: Requests a mobile OTP challenge.
   - `POST /api/v1/auth/otp/verify`: Verifies the challenge code and issues a canonical Customer session response with `accountId`.
   - `POST /api/v1/auth/sessions/refresh`: Rotates the refresh token and issues a new access token for the authenticated `accountId`.
   - `DELETE /api/v1/auth/sessions/current`: Revokes the active session on the backend.

---

## 2. Session Response DTO Shape

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

---

## 3. Installation Identifier Strategy

- **Format**: UUIDv4 generated using `expo-crypto`'s `randomUUID()`.
- **Properties**: Generated once per installation, stored securely, length <= 128 characters, zero hardware/advertising/push-token dependencies.

---

## 4. Session Storage & Refresh Strategy

- **Native (iOS/Android)**: `expo-secure-store` used for long-lived refresh credentials (`refreshToken`, `refreshTokenExpiresAt`, `accountId`, `mobile`, `role`). `accessToken` remains runtime-only.
- **Expo Web**: `window.sessionStorage` used for session state; `localStorage` strictly prohibited for refresh credentials.
- **Central Refresh Handling**: Single in-flight Promise coalesces concurrent `401` requests. Retries original request once on success. Never refreshes on `403`. Clears session on terminal refresh failure.
