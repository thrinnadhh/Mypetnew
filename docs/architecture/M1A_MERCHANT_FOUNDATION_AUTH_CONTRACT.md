# M1A — Merchant App Foundation and Authentication Contract

Status: Sprint 1 implementation contract
Date: 2026-08-13
Scope: S1-03, S1-05; identity portions required to make Merchant onboarding real

## Authority

- Spring Boot is the sole authentication, role, session and authorization authority.
- Supabase Auth and direct Supabase domain access are prohibited.
- The Merchant app never submits or mutates a role value.
- Merchant login uses the generic OTP request endpoint and a Merchant-specific verification endpoint whose server route fixes the resulting role to `MERCHANT`.
- OTP verification proves mobile control only. Production session issuance requires a pre-existing canonical `ACTIVE` `MERCHANT` identity; OTP alone never creates or upgrades a Merchant role.
- Existing organization/outlet membership claims are derived from canonical server-owned membership, never client fields.
- A newly authenticated Merchant may have no organization/outlet yet. That state is valid for onboarding only; tenant-owned transaction commands remain unavailable until canonical outlet membership is established.
- Refresh rotation preserves the server-owned role. Access tokens are runtime-only; native refresh state is stored as one versioned SecureStore record.

## HTTP contract

- `POST /api/v1/auth/otp/request` with purpose `LOGIN` requests a challenge.
- `POST /api/v1/auth/merchant/otp/verify` verifies the challenge and creates a session only for an authorized canonical `MERCHANT`. The request contains challenge/mobile/purpose/code only; no role or tenant fields are accepted.
- `POST /api/v1/auth/sessions/refresh` rotates the refresh token and preserves the stored role.
- `DELETE /api/v1/auth/sessions/current` revokes the current session.

## Merchant app contract

`apps/merchant-app` is a separate Expo SDK 56 application using Expo Router. It must provide:

1. startup configuration validation;
2. OTP request and verification;
3. versioned SecureStore refresh-state persistence on native;
4. runtime-only access token storage;
5. one in-flight refresh for concurrent 401s, including staggered stale-token responses;
6. no refresh on 403 or auth lifecycle endpoints;
7. role validation requiring `MERCHANT`;
8. logout that reports success only after the server session is revoked; transient offline/server failure retains local state for retry;
9. intentional loading, offline, retry and unauthorized UI states;
10. no mock/demo identity fallback in production paths;
11. serialized secure-storage mutations so an older refresh cannot overwrite newer login/logout credentials.

## Security invariants

- A Customer verification endpoint still creates only `CUSTOMER` sessions.
- Merchant verification creates only `MERCHANT` sessions for an existing active Merchant identity.
- A caller cannot obtain MERCHANT authority by sending a client role field.
- Session creation rejects unsupported roles.
- Refresh replay remains invalid after rotation.
- Protected Merchant requests re-resolve current organization/outlet membership server-side so stale token scopes do not preserve revoked tenant access.
- Transient refresh/network failure does not erase a still-valid persisted refresh credential; definitive invalid/revoked session responses fail closed.
- Logs and string representations never expose refresh tokens.

## Dependency and build-tool security boundary

- `apps/merchant-app/package-lock.json` must be generated from the Merchant manifest itself; Customer-only dependencies are not permitted in the Merchant lock graph.
- The Expo 56 / Metro build dependency graph currently inherits two GitHub-reviewed High `image-size` denial-of-service advisories: `GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq`.
- As of 2026-08-13 GitHub lists no patched `image-size` release for either advisory. Forcing the audit suggestion would downgrade Expo across a breaking major boundary and is not an accepted fix.
- These advisories are treated as a bounded build-tool exception, not as application-runtime authorization risk. Merchant CI parses `npm audit --omit=dev --json` and fails on any Critical advisory or any High advisory whose direct advisory root is not one of the two explicit GHSAs above.
- Re-review is mandatory on the next Expo/Metro dependency update, when either GHSA publishes a patched version, or no later than 2026-08-27. Until then, M1A does not claim a zero-advisory npm tree; it claims a guarded, explicitly scoped exception.

## External integration boundary

- The repository supplies an in-memory OTP provider only for `test` and `development`. A production SMS/OTP provider remains swappable behind `OtpProvider` and is not invented by M1A because the product decisions do not lock a vendor.
- Therefore M1A repository certification covers the canonical OTP/session contract and fail-closed production identity/session authority, but does not claim real SMS sandbox/production delivery evidence.

## Verification mapping

Primary hard-test IDs: `S1-ARC-004..006`, `S1-AUTH-002..009`, `S1-AUTH-012`, plus Merchant portion of `S1-MOB-001` and Sprint-1 role-client gate.

M1A does not implement outlet onboarding, Admin approval, barcode, scanner, inventory, orders, POS, loyalty mutation or notifications. Those belong to later M1 slices.
