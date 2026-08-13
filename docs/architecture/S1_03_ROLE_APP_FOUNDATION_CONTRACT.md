# S1-03 Role App Foundation Contract

Status: implementation contract

Sprint 1 only. This slice establishes separate Merchant and Captain Expo clients plus the Admin Next.js shell and shared design tokens. It does not implement scanner, inventory, fulfilment, POS, delivery, online payment, recurring orders, grooming/vet, coupons, settlement, or expanded Admin operations.

## Authority

Kotlin/Spring Boot remains the sole authentication, authorization, tenant, domain and transaction authority. Role clients must never infer permissions or business state from local UI state. Supabase/Firebase are infrastructure/providers only.

## Shell acceptance

- Merchant app boots into an operations shell with only Sprint-1 destinations represented as disabled/pending cards until their owning ticket lands.
- Merchant notification inbox route exists as an empty shell; no fake notification data.
- Captain app is explicitly shell-only and exposes no delivery/dispatch actions.
- Admin web exposes only the Sprint-1 provider-review control-plane placeholder; no operational mutation is simulated.
- All three clients consume the same design-token package.
- Minimum touch targets are 48dp/px-equivalent and layouts use responsive gutters.
- Deferred capabilities are visibly unavailable rather than enabled dead controls.

## Follow-on ownership

S1-05 owns role/RBAC integration. S1-06 owns Merchant onboarding/Admin approval. S1-07..S1-10 own catalog/scanner/inventory. S1-14 owns fulfilment. S1-15 owns POS. S1-17 owns real FCM/inbox/deep links.
