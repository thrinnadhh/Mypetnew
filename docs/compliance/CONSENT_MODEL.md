# Consent model

Status: engineering design, 2026-08-15. Legal must approve the notice text, appropriate lawful uses and production consent language. The model does not treat a Terms acceptance as consent for optional processing.

## Purpose ledger

| Purpose | Default | Product behavior without grant | Proof captured | Withdrawal effect | Status |
|---|---|---|---|---|---|
| `LOCATION` | Off | No address/GPS collection; manual alternatives must remain | account, purpose, notice version, source, grant/withdraw timestamps | Stop future location collection and clear ephemeral state; retained order delivery facts follow schedule | Ledger implemented; location feature absent |
| `NOTIFICATIONS` | Off | Core service remains usable; in-app status is the fallback | same, plus device registration remains separate | Revoke optional sends and unregister token where applicable | Ledger and unregister API implemented; orchestration pending |
| `MARKETING` | Off | No promotional messages | same | Stop future marketing; suppression proof may remain | Ledger implemented; channel absent |
| `PERSONALISATION` | Off | Generic experience | same | Stop profile-based ranking and delete derived profile per schedule | Ledger implemented; feature absent |
| `PRODUCT_ANALYTICS` | Off | Only strictly necessary security/operational telemetry | same | Stop optional events and delete/pseudonymise provider identifiers | Ledger implemented; provider absent |
| `RECURRING_ORDER_REMINDERS` | Off | No reminder automation | same | Cancel future reminders | Ledger implemented; feature absent |

Necessary processing for sign-in, requested commerce, security, fraud prevention, records required by law, and rights handling must be described in the privacy notice and must not be disguised as optional consent. Whether a specific operation relies on consent or another permitted ground is a legal decision recorded in the processing register, not inferred by code.

## Technical contract

- The authenticated principal supplies `customerId`; clients cannot submit or select another person's identifier. The Customer endpoint accepts only `CUSTOMER_APP` as its source and rejects a forged support-assisted source.
- `PUT /api/v1/privacy/consents/{purpose}` creates an immutable grant and withdraws a previous active grant for the same purpose. It records a restricted `noticeVersion` and source.
- `DELETE /api/v1/privacy/consents/{purpose}` timestamps the active record; it does not erase proof that a grant existed.
- The Customer Privacy Centre presents each optional purpose independently. Adult-product eligibility is a separate mandatory attestation and stores no date of birth.
- Withdrawal must be as easy as grant. Customer FCM registration requires an active `NOTIFICATIONS` grant, and withdrawal revokes all Customer registrations and protected tokens. A general downstream processor fan-out/outbox is not implemented, so other optional provider processing must stay disabled until propagation is proven.
- A notice version must be immutable and retrievable. Production needs an approved notice registry mapping version, languages, purposes, fields, processors, retention and effective date. The database currently stores only the version string.

## Required release tests

Grant, duplicate grant supersession, independent toggles, withdrawal, stale/unknown notice rejection, retry/idempotency, logout, account deletion, and downstream suppression must be tested. Current automated tests cover owner binding, source forgery rejection, grant/withdraw, Customer FCM gating/revocation and deletion withdrawal. Notice-registry enforcement, general queue propagation and processor deletion proof remain blockers.

No pre-ticked control, bundled optional purposes, forced marketing, false urgency, confirm-shaming, obstruction or repeated nagging is permitted. UI changes require a dark-pattern review against the Consumer Protection framework.
