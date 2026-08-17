# P1 — Customer Frontend Production Baseline

Baseline commit audited: `336f4b149840222870c43e0e2c544f18bde482e2` (`main`).

This document is evidence, not a production-ready declaration. Later P-phases must refresh evidence from current `main` and may not inherit stale green results.

## Evidence states

- **VERIFIED** — direct repository/tool/CI evidence exists.
- **INFERRED** — strong evidence exists but runtime verification was unavailable.
- **UNVERIFIED** — direct evidence is insufficient.
- **FAILED** — an executed check failed.

## Repository and PR hygiene

- VERIFIED: authoritative repository is `thrinnadhh/Mypetnew`; default branch is `main`.
- VERIFIED: baseline `main` SHA is `336f4b149840222870c43e0e2c544f18bde482e2`.
- VERIFIED: stale backup PR #51 (`backup/pr41-loyalty-pre-refresh-20260816`) was closed without merge during this audit. Backup branches are not release candidates.
- VERIFIED: repository supports merge, squash, and rebase merge; GitHub native auto-merge is disabled.

## Customer toolchain

- VERIFIED: Expo `~56.0.19`, Expo Router `~56.2.18`, React Native `0.85.3`, React `19.2.3`, TypeScript `~6.0.3`, Jest `29.7.0`.
- VERIFIED: `AGENTS.md` requires exact Expo SDK 56 documentation before implementation.
- VERIFIED: Customer scripts expose `typecheck`, `lint`, `test`, and coverage commands.
- VERIFIED: `.github/workflows/validate-restored-customer.yml` uses Node 22, `npm ci`, production dependency advisory guard, typecheck, lint, Jest, and Android Expo export.
- VERIFIED: the `validate-restored-customer` push run for the baseline SHA completed successfully. This is the mechanical P1 baseline only; every changed phase requires fresh exact-head evidence.

## Route and journey inventory

Direct route-tree inspection confirms current Customer surfaces for:

- tabs: home, search, orders, profile
- authentication: login
- commerce: stores, shop/provider detail, products, categories, product detail, favourites, cart, checkout
- care: grooming discovery/detail, veterinary discovery/detail, provider detail
- appointments: discovery/booking, list, detail, payment
- post-purchase: order detail/tracking projection
- account/secondary: subscriptions, wallet, support, chat, health reports, vaccinations, guides, legal, privacy

Several routes are thin aliases into shared templates. P2–P15 must verify that aliases do not create duplicate navigation semantics or stale route contracts.

## Design-system baseline

- VERIFIED: `src/design/tokens.ts` already provides a canonical token layer: light/dark palette, spacing, radii, 48dp touch target, Inter typography, shadows, and semantic theme values.
- VERIFIED: foundation/UI primitives already exist (`ScreenShell`, route foundation, primitive controls, `PrimaryButton`, `TextField`, `ScreenHeader`, `ServiceTile`, `StatusBadge`, resilient remote image, cards).
- Decision: extend these canonical primitives instead of introducing a second design system.
- Decision: P2–P15 may redesign screens substantially, but reusable values belong in the canonical token/primitives layer rather than per-screen magic values.

## External design intelligence

- VERIFIED on 2026-08-18: `nextlevelbuilder/ui-ux-pro-max-skill` publishes React Native guidance and is MIT licensed.
- License rule: if source code/data from that project is copied or substantially vendored, preserve the MIT copyright/permission notice as required. Pure design principles do not require vendoring the tool or its executable installer.
- Security rule: do not execute or vendor third-party CLI/install scripts merely to obtain recommendations. Prefer inspected guidance translated into the existing Expo/React Native stack.
- Expo rule: use SDK 56 documentation as framework authority. Safe-area handling should use the installed `react-native-safe-area-context` APIs and provider semantics documented for SDK 56.

## Environment and secret hygiene

- VERIFIED: root `.gitignore` excludes `.env` and `.env.*`, except committed example templates.
- VERIFIED: `.env.staging.example` documents staging contracts for PostgreSQL/Supabase, Firebase/FCM, Cashfree sandbox, and `EXPO_PUBLIC_API_BASE_URL`.
- UNVERIFIED in this automation execution: the user's ignored local `.env` values. The available GitHub execution surface cannot read ignored workstation files, and no checked-out secret-bearing runtime is mounted here.
- Rule: never copy Cashfree client secret, Supabase service-role key, database password, token secret, device-token key, or Firebase service-account private key into Git, PR text, CI logs, screenshots, or Expo public variables.
- Rule: `EXPO_PUBLIC_*` values are public-by-design and must never contain server credentials.

## P1 defect/risk matrix feeding later phases

| Risk | State | Owning phase |
|---|---|---|
| Route aliases / back-stack / deep-link consistency | UNVERIFIED | P2 |
| Global loading/error/empty/offline consistency | UNVERIFIED | P2/P15 |
| Home/serviceability responsive behavior | UNVERIFIED | P3 |
| Commerce discovery/filter/pagination semantics | UNVERIFIED | P4 |
| Product/cart single-merchant and stock UX | UNVERIFIED | P5 |
| Search/favourites auth boundaries | UNVERIFIED | P6 |
| Quote/checkout server-authoritative totals | UNVERIFIED | P7 |
| Order projection/tracking/cancel recovery | UNVERIFIED | P8 |
| Grooming discovery and serviceability | UNVERIFIED | P9 |
| Groomer services/slots/booking handoff | UNVERIFIED | P10 |
| Veterinary services/slots/booking handoff | UNVERIFIED | P11 |
| Appointment hold/create concurrency UX | UNVERIFIED | P12 |
| Cashfree appointment payment/recovery | UNVERIFIED | P13 |
| Profile/pets/addresses/loyalty/wallet/subscriptions | UNVERIFIED | P14 |
| Accessibility/i18n/keyboard/offline/deep-link sweep | UNVERIFIED | P15 |
| Public staging HTTPS, live provider credentials, device-native certification | UNVERIFIED | P16 |

## P1 completion gate

P1 is complete only after this baseline PR itself receives fresh exact-head Customer CI, the diff is reviewed for accidental/secret changes, and merged `main` is re-fetched. P2 must start from that post-merge `main`, never from this audit branch.
