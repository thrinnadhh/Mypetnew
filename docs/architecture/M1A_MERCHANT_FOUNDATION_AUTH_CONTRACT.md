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
5. one in-flight refresh for concurrent 401s;
6. no refresh on 403 or auth lifecycle endpoints;
7. role validation requiring `MERCHANT`;
8. logout that revokes server session and clears local state;
9. intentional loading, offline, retry and unauthorized UI states;
10. no mock/demo identity fallback in production paths.

## Security invariants

- A Customer verification endpoint still creates only `CUSTOMER` sessions.
- Merchant verification creates only `MERCHANT` sessions for an existing active Merchant identity.
- A caller cannot obtain MERCHANT authority by sending a client role field.
- Session creation rejects unsupported roles.
- Refresh replay remains invalid after rotation.
- Logs and string representations never expose refresh tokens.

## Verification mapping

Primary hard-test IDs: `S1-ARC-004..006`, `S1-AUTH-002..009`, `S1-AUTH-012`, plus Merchant portion of `S1-MOB-001` and Sprint-1 role-client gate.

M1A does not implement outlet onboarding, Admin approval, barcode, scanner, inventory, orders, POS, loyalty mutation or notifications. Those belong to later M1 slices.
