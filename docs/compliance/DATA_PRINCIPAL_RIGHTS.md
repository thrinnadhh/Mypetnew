# Data Principal rights and grievance workflow

Status: source implementation plus operating procedure, 2026-08-15. The statutory rules' operational provisions are phased; this service is being built early. Legal/DPO must approve rejection reasons, identity recovery, nomination execution and regulator communications.

## Supported self-service paths

| Need | Endpoint / behavior | Identity and scope | Current state |
|---|---|---|---|
| Summary/access | `GET /api/v1/privacy/me` | Active Customer token; actor ID is server-derived | Implemented summary, not portable full export |
| Correction | `PATCH /api/v1/privacy/me` and `POST .../rights-requests` with `CORRECTION` | Same; no arbitrary customer ID | Profile edit implemented; commerce correction case handling pending |
| Erasure | `POST .../rights-requests` with `ERASURE` | Same | Case submission implemented |
| Account deletion | `DELETE /api/v1/privacy/account` with exact confirmation `DELETE` | Same; disables identity first | Direct identifier erasure/revocation implemented and tested |
| Grievance | `POST /api/v1/privacy/grievances` | Same | Intake implemented; assignment/escalation/response workflow pending |
| Nomination | `POST /api/v1/privacy/nomination` | Same | Intake only; nominee identity/authority verification pending |
| Case list/detail | `GET .../rights-requests` and `GET .../{requestId}` | Repository requires both actor and request ID | Implemented; cross-user IDOR test passes |

## Case state machine

`REQUESTED → IDENTITY_VERIFIED → IN_REVIEW → COMPLETED`

An exceptional `REJECTED_WITH_LAWFUL_REASON` state requires an approved, user-readable reason and appeal/grievance route. Cases must not be closed solely because data exists in a backup. Default internal targets are acknowledgement within 48 hours, triage within 7 days, and completion well inside the configured 90-day outer grievance/rights target; a shorter legal or incident deadline prevails.

The current API creates an authenticated case directly at `IDENTITY_VERIFIED`. Production still needs durable assignment, status-transition authorization, deadline alerts, export generation, communication templates and evidence of delivery. Support-assisted recovery must use a separately reviewed identity process; staff must not ask for OTPs or payment credentials.

## Account deletion sequence

1. Reauthenticate at the product layer and obtain deliberate confirmation. The current endpoint confirms text but has no step-up/recent-auth check; that is a release blocker.
2. Mark identity `DELETION_PENDING`/`DELETED` so new sessions cannot be created.
3. Revoke every refresh session and device registration and blank encrypted FCM material.
4. Erase mobile, name, email and adult-attestation; delete cart; withdraw active optional consent.
5. Create account deletion receipt and non-PII tombstone. Keep transaction records only where legal approves the purpose and period.
6. Reapply tombstones after every backup restore and purge/pseudonymise retained records when their schedule expires.
7. Send a confirmation without exposing erased content; document exceptions and review date.

Deletion is idempotent in the repository. Current automated evidence proves old access/refresh tokens and registered device state become unusable and re-login cannot recreate the account. It does not prove provider backup purge or downstream processor deletion.

## Operating controls

- Public privacy/grievance contact details and DPO/authorized contact are `LEGAL_ACTION_REQUIRED`; do not publish placeholders.
- Case workers receive least-privilege views and every access/status change should be audited.
- Exports must be machine-readable where appropriate, encrypted in transit, short-lived, and delivered only after identity verification.
- Metrics: open cases by age, overdue cases, rejection rate/reason, restore suppression failures, provider deletion failures. Metrics must not expose request text.

