# T2A — Customer Authentication & Session Contract

Status: **Implementation contract**  
Sprint: **Sprint 1 Recovery & Certification / T2A**  
Authority: `docs/product/DECISIONS.md` (especially D-024), `docs/product/PRD.md`, backend identity implementation, this contract.

## 1. Objective

Replace the restored Customer app's direct Supabase Auth authority with the canonical MyPetNew Spring identity/session API while preserving a safe, testable Customer login experience.

T2A is authentication/session work only. It must not expand into catalog, checkout, pets, notification-contact, customer-profile, Google OAuth, email OTP, phone-change, Cashfree, or later-sprint features.

## 2. Authority boundary

For Sprint 1:

- The Spring backend is the **only authentication and session authority**.
- Supabase remains PostgreSQL/object-storage infrastructure only; `supabase.auth.*` is not a valid Customer authentication path.
- The client must never construct or infer server roles.
- The client must never decode the opaque MyPetNew bearer token to discover identity or authorization facts.
- Role comes from the server-issued session response and must be `CUSTOMER` for the Customer app.

## 3. Canonical server endpoints

Base: `/api/v1/auth`

### 3.1 Request login OTP

`POST /api/v1/auth/otp/request`

Request:

```json
{
  "mobile": "+919876543210",
  "purpose": "LOGIN",
  "deviceId": "opaque-installation-uuid"
}
```

Response:

```json
{
  "challengeId": "uuid",
  "expiresAt": "ISO-8601",
  "resendAfterSeconds": 30
}
```

The client must use the server-returned resend delay rather than a hard-coded countdown.

### 3.2 Verify login OTP

`POST /api/v1/auth/otp/verify`

Request:

```json
{
  "challengeId": "uuid",
  "mobile": "+919876543210",
  "purpose": "LOGIN",
  "code": "123456"
}
```

Response contract after T2A:

```json
{
  "accountId": "uuid",
  "accessToken": "opaque-token",
  "refreshToken": "opaque-secret",
  "tokenType": "Bearer",
  "accessTokenExpiresAt": "ISO-8601",
  "refreshTokenExpiresAt": "ISO-8601",
  "role": "CUSTOMER"
}
```

`accountId` is an additive backend response field. It is required because the backend owns authenticated identity and the restored Customer app needs an account identifier. The client must not parse the access token to recover it.

### 3.3 Refresh

`POST /api/v1/auth/sessions/refresh`

Request:

```json
{
  "refreshToken": "opaque-secret"
}
```

Response: same session response as OTP verification, including `accountId`.

Refresh rotation is mandatory: after a successful refresh, the old refresh token is obsolete and the new token must replace it atomically in client storage.

### 3.4 Sign out

`DELETE /api/v1/auth/sessions/current`

Send the current bearer access token. The client clears local credentials even if revocation cannot be completed because of a network failure; server-side residual session lifetime remains bounded by the refresh-session expiry.

## 4. Client identity model

Do not expose Supabase `Session` or `User` types from `AuthContext`.

Use MyPetNew-owned client types equivalent to:

```ts
export interface CustomerAuthUser {
  id: string;
  phone: string;
  displayName: string | null;
}

export interface CustomerAuthSession {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  role: 'CUSTOMER';
  mobile: string;
}
```

`displayName` is not an auth-provider metadata field. Until a canonical Customer profile write/read contract exists, it may be `null` and UI must use a safe fallback. T2A must not create a profile endpoint merely to preserve Supabase metadata behavior.

## 5. Device / installation identifier

`deviceId` is an application-generated opaque installation identifier, not a hardware/device fingerprint.

Requirements:

- generate once with an Expo SDK 56-compatible cryptographically random UUID API (`expo-crypto` `randomUUID()` is approved),
- persist it locally,
- maximum length 128 characters,
- reuse it for OTP requests on the same installation,
- do not use IMEI, Android ID, advertising ID, phone number, push token, or other hardware identifiers.

## 6. Credential storage

### Native Android/iOS

Use Expo SDK 56 `expo-secure-store` for refresh-session persistence.

Persist only the minimum restart state needed to restore the session, including:

- refresh token,
- refresh expiry,
- account ID,
- verified mobile,
- role,
- installation/device ID where appropriate.

The access token should be treated as short-lived runtime state. On cold start, restore the persisted refresh state and call the refresh endpoint to obtain a fresh access token and rotated refresh token.

### Web

Do not put refresh credentials in `localStorage`. If Expo web behavior must remain functional in T2A, use a tab/session-scoped browser store (`sessionStorage`) and document that web login is not persistent across a browser-session boundary.

## 7. Session restoration and refresh behavior

On application startup:

1. Load persisted restart state.
2. If absent or refresh expiry is already past, start signed out and clear stale storage.
3. If present, call `/api/v1/auth/sessions/refresh`.
4. On success, replace the refresh token with the newly rotated token, set the new access token into the shared API client, and expose the authenticated Customer state.
5. On terminal refresh failure, clear local session state and become signed out.

For authenticated API requests:

- attach the current bearer token centrally,
- when a request receives a genuine `401`, permit at most one coordinated refresh attempt,
- concurrent `401` responses must share one in-flight refresh operation rather than rotating the same refresh token multiple times,
- after successful refresh, retry each failed request at most once,
- never recurse refresh-on-refresh,
- `403` must not trigger a token refresh,
- if refresh fails or the retried request is still `401`, clear auth state and surface authentication-required behavior.

## 8. OTP UX rules

Sprint 1 Customer login is **mobile OTP only** because that is the implemented canonical backend login contract.

The active login UI must not offer or invoke:

- Supabase email OTP,
- Google OAuth through Supabase,
- Supabase phone-change/linking,
- client-authored role metadata.

Resend means requesting a fresh `LOGIN` challenge using the same normalized mobile and installation ID after the server-provided `resendAfterSeconds` delay. There is no separate canonical resend endpoint.

OTP error mapping must be based on the MyPetNew API error envelope/codes, not Supabase Auth error strings. Preserve stable user-facing categories for invalid input/code, expiry, attempts/rate limits, network failure, and unknown errors.

## 9. Profile and communications boundary

T2A must remove authentication-time dependency on legacy/stale calls that are not backed by a canonical Sprint-1 backend contract, including current Supabase metadata updates and auto-sync assumptions.

Specifically:

- do not call `/api/v1/profiles/sync` as part of establishing a MyPetNew session unless a canonical backend endpoint is proven in the current branch,
- do not make `/api/v1/notifications/contact/me` a prerequisite for successful authentication unless a canonical backend endpoint is proven in the current branch,
- do not block login because profile/contact sync is unavailable,
- profile name persistence and notification-contact synchronization belong to their owning contracts/tickets.

## 10. Backend acceptance requirements

- `OtpSessionResponse` includes `accountId` for both OTP verification and refresh.
- Account ID comes from the verified/rotated backend session, never from a client request.
- Refresh continues to rotate refresh tokens and revoke the old session.
- Logout continues to revoke the authenticated current session.
- Existing identity/security tests remain green.
- Add contract tests proving verify/refresh return the same authenticated account identity and CUSTOMER role.

## 11. Customer acceptance requirements

Active Sprint-1 auth/session paths must satisfy all of the following:

- no `supabase.auth.*` call is used to sign in, restore, refresh, update auth metadata, link phone, or sign out,
- no Supabase `Session`/`User` type is used as Customer auth state,
- login uses `/api/v1/auth/otp/request` and `/api/v1/auth/otp/verify`,
- request body includes `purpose: "LOGIN"` and stable `deviceId`,
- resend uses a fresh OTP request and server delay,
- verified backend session becomes the single Customer auth state,
- API client receives the MyPetNew access token,
- cold-start restoration uses refresh-token rotation,
- concurrent refresh is single-flight,
- sign-out invokes `/api/v1/auth/sessions/current` best-effort and clears local credentials,
- `user.id` consumers receive the backend `accountId`, not a Supabase user ID,
- role is server-derived,
- active login screen is mobile OTP only,
- profile-name absence has a safe UI fallback rather than a fake Supabase metadata write.

## 12. Required tests

At minimum add/adjust tests for:

1. OTP request route/body and normalized Indian mobile.
2. OTP verification route/body and server session mapping.
3. Server-provided resend delay.
4. `accountId` on verify and refresh responses.
5. Secure native refresh-session storage and stale-expiry clearing.
6. Stable app-generated installation ID.
7. Cold-start successful refresh + refresh-token replacement.
8. Cold-start invalid/expired refresh -> signed out + storage cleared.
9. One-flight refresh under concurrent `401`s.
10. Exactly one request retry after refresh.
11. `403` does not refresh.
12. Sign-out revocation request + local cleanup.
13. No active Supabase Auth authority in login/context/session implementation.
14. No active Google/email/phone-link auth UI for Sprint 1.
15. Existing fresh-OTP intent behavior remains intact.

## 13. Verification gate

Run from repository root:

```bash
./gradlew :backend:check --no-daemon --no-configuration-cache
```

Then:

```bash
cd apps/customer-app
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
```

Also inspect:

```bash
rg "supabase\.auth|@supabase/supabase-js" apps/customer-app/src/auth apps/customer-app/src/context apps/customer-app/src/app/login.tsx
rg "/api/v1/profiles/sync|/api/v1/notifications/contact/me" apps/customer-app/src/context apps/customer-app/src/app/login.tsx
rg "X-User-Role|user_metadata|app_metadata" apps/customer-app/src/auth apps/customer-app/src/context apps/customer-app/src/app/login.tsx
```

Any remaining result must be explained and must not represent an active Sprint-1 auth authority.

## 14. Explicitly out of scope

- T2B catalog migration
- T2C quote migration
- T2D checkout/order migration
- T2E order detail/tracking migration
- T2F loyalty migration
- T3 Pets
- Google OAuth
- email OTP
- phone-number change/linking
- Customer profile CRUD/name persistence
- push/contact synchronization
- Cashfree or online payments
- Sprint 2+

## 15. Merge gate

T2A is mergeable only when:

- backend CI is green,
- Customer CI is green,
- GPT-5.6 Sol review finds no high/critical auth/session defect,
- no active direct-Supabase authentication path remains in Sprint-1 Customer login/session code,
- refresh rotation and retry behavior are covered by deterministic tests.
