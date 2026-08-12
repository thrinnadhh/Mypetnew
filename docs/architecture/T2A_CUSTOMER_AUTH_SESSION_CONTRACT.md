# T2A Customer Auth & Session Architecture Contract — MyPetNew

Status: **Authoritative**
Version: **1.1**
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
  "accessToken": "opaque-access-token",
  "refreshToken": "opaque-refresh-secret",
  "tokenType": "Bearer",
  "accessTokenExpiresAt": "2026-08-12T19:00:00Z",
  "refreshTokenExpiresAt": "2026-09-11T18:00:00Z",
  "role": "CUSTOMER"
}
```

**Server Role Authority**: For both OTP verify and refresh, the client strictly validates `response.role === 'CUSTOMER'`. A non-`CUSTOMER` role (`MERCHANT`, `CAPTAIN`, `ADMIN`, missing, or unknown) is never converted into `CUSTOMER` and is never published as authenticated Customer state.

---

## 3. Verified Mobile Session Construction

- The backend accepts only Indian mobile numbers matching `+91[6-9][0-9]{9}`; the Customer client normalizes and validates to the same contract before requesting or verifying OTP.
- `verifyOtpCode` combines the server session response (`accountId`, tokens, expiration) with the exact normalized mobile that the backend just verified.
- `CustomerAuthSession.mobile` must be non-empty and valid before persistence or publication.
- Token refresh retains the already persisted verified mobile; bearer tokens remain opaque and are never decoded for identity data.

---

## 4. Installation Identifier Strategy

- **Format**: UUIDv4 generated using `expo-crypto` `randomUUID()`.
- **Properties**: Generated once per installation/session-storage scope, stored before use, length <= 128 characters, with zero hardware/advertising/push-token dependencies.
- **Native failure policy**: If secure installation storage is unavailable, OTP establishment fails closed instead of silently substituting a per-process identifier that would weaken device-based throttling.

---

## 5. Session Storage & Refresh Strategy

- **Native (iOS/Android)**: `expo-secure-store` holds one versioned JSON refresh-state record containing `refreshToken`, `refreshTokenExpiresAt`, `accountId`, `mobile`, `role`, and `deviceId`. `accessToken` remains runtime-only.
- **Expo Web**: `window.sessionStorage` holds the same single versioned record; `localStorage` is prohibited for refresh credentials.
- **Atomic record policy**: A rotated refresh state is written as one record, preventing mixed old/new token, account, mobile, or expiry fields after a partial multi-key write.
- **Strict load validation**: Malformed JSON, invalid/expired timestamps, blank required values, invalid mobile state, or a non-`CUSTOMER` role clears the persisted record and results in signed-out state.
- **Persistence-First Policy**: Restart state is validated and persisted before authenticated state is published to UI subscribers. Storage failures reject session establishment and do not publish a half-authenticated session.
- **Serialized mutations**: Session saves and clears are serialized so sign-out, refresh rotation, and a newly established login cannot leave storage in an older auth generation.

---

## 6. Central 401 Refresh & Auth Generation Rules

- One in-flight refresh Promise is shared by concurrent protected requests that receive `401`.
- A successful refresh retries each original request once. A retried request that still returns `401` terminates the session; there is no recursive refresh loop.
- `403` never triggers refresh.
- Auth lifecycle endpoints (`otp/request`, `otp/verify`, `sessions/refresh`, `sessions/current`) never recursively trigger refresh.
- Each login/sign-out establishes a new auth generation. A stale request or refresh from an older generation must fail without clearing or overwriting the newer session.
- An older refresh Promise finalizer must not erase a newer in-flight refresh Promise.

---

## 7. Sprint-1 Login Scope

- Active Customer authentication is mobile OTP only.
- Google OAuth, email OTP, and phone-change/linking are deferred until canonical Spring contracts exist.
- Supabase Auth metadata is not Customer profile authority.
- Authentication establishment must not depend on unproven profile/contact synchronization endpoints.
- Guest browsing remains available; protected account/checkout actions can require authentication through the existing auth-intent flow.
