# Notification operations runbook

Canonical order, POS, and loyalty state is authoritative before notification delivery. Provider success never creates or advances business state.

## Provider outage

1. Verify the environment-to-Firebase project mapping without logging credentials or raw device tokens.
2. Pause or throttle dispatch while leaving committed outbox/inbox state intact.
3. Classify failures: transient responses use bounded exponential retry; invalid/unregistered tokens disable only the matching registration; exhausted events enter the dead-letter queue.
4. After recovery, replay by logical notification ID and source event ID. Confirm there is one inbox notification and no duplicate business effect.

## Credential or environment incident

Disable sends, rotate the server-side credential, revoke the old credential, rebuild only if public app configuration changed, and prove that development/staging cannot send through production. Scan source, artifacts, logs, and client bundles before reopening delivery.

## Safe payload check

Allow only a versioned template, safe title/body, opaque notification/resource IDs, and an allowlisted route. Never include OTPs, tokens, full phone/address, payment or medical details, proofs, authoritative totals/status, or provider credentials. A tapped notification fetches canonical state and applies current authorization.

The repository includes encrypted JDBC device registration, durable notification/outbox/attempt projections, bounded claim recovery and retry/dead-letter logic, and an FCM HTTP v1 adapter using Google application-default credentials. The real Firebase outage/recovery drill and physical-device delivery matrix remain certification blockers until these components are exercised in isolated staging.
