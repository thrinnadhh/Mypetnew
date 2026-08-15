# Compliance evidence and readiness matrix

Assessment date: 2026-08-15. Overall engineering readiness: **57/100** (unweighted mean of the 15 requested dimensions, rounded). This is a progress measure, not a legal-compliance score or certification.

Scoring rubric: 0 = absent/unknown; 25 = documented intent only; 50 = meaningful source implementation but important controls unimplemented; 75 = automated source evidence with operating/deployment proof still incomplete; 100 = approved, deployed, independently tested, monitored and evidenced. Unknown production/provider facts cap a category below 75.

| Dimension | Score | Evidence present | What prevents a higher score / next accountable action |
|---|---:|---|---|
| Data inventory completeness | 78 | `DATA_INVENTORY.md`, Flyway V1–V11, explicit absent-flow register, field-purpose/access/retention classification | Verify real production schema/config/buckets, CI/provider logs and every processor; Data/Privacy owner signs quarterly inventory |
| Consent capture and withdrawal | 66 | purpose-specific V11 ledger; actor/source-bound PUT/DELETE; independent default-off Customer UI; FCM consent gate/revocation and grant/withdraw tests | Approved immutable notice registry, general downstream suppression/outbox, retry/idempotency and accessibility/dark-pattern evidence absent |
| Rights and deletion workflow | 66 | self summary/profile/case/grievance/nomination/delete API; deletion transaction; cross-user and session/FCM revocation tests | Full export/correction workflow, step-up auth, assignment/SLA alerts, staff authorization, provider/backup deletion proof absent |
| Authentication/session security | 68 | hashed/salted OTP state; cooldown/attempt cap; short access + hashed rotating refresh; replay/logout/disable tests; SecureStore | Distributed OTP/rate store, production SMS adapter, device/anomaly controls, recovery process and physical extraction tests absent |
| Authorization and IDOR resistance | 65 | server-derived principal; role/org/outlet guards; cross-user privacy and cross-merchant contract tests | Production repository/admin surfaces incomplete; Captain/assignment domain absent; no deployed/API dynamic test suite or DB defence-in-depth evidence |
| Location privacy | 55 | no location fields/permissions/provider; separate default-off purpose and future gate documented | No future data design, permission/precision/TTL/manual-alternative enforcement or physical OS tests; score recognises minimisation, not a completed feature |
| FCM token/payload/logout safety | 69 | AES-GCM protected token, fingerprint, notification-consent gate, owner-bound unregister/revoke-all with material erasure, invalid-token handling, route/resource allowlist, sensitive-text rejection tests | Firebase IAM/region/KMS/rotation and physical zero-delivery/background/killed-state evidence absent |
| Data-layer boundaries | 62 | backend-only JDBC; typed/parameterised persistence; private schema/storage design; constraints/transactions/migrations | Deployed grants/RLS/network/bucket policy, India region, restore, production commerce persistence and Redis design evidence absent |
| Payment-data exclusion | 55 | no payment integration/credential fields; CI rejects PAN/CVV/UPI-PIN/bank-password-shaped production fields; hosted-payment rule | Cashfree/provider selection, approved contract/region, hosted UI test, signed raw-body webhook, idempotency/reconciliation and log proof absent |
| Third-party/processor governance | 30 | processor/transfer register and procurement checklist with unknowns explicit | Contracts/DPAs, regions, subprocessors, breach SLAs, transfer decisions, retention/deletion and audit evidence mostly absent; procurement/legal owner required |
| Encryption/secrets | 60 | protected FCM token, token hashing, native secure storage, HTTPS runtime guard, secret scan and public-secret denylist | Production KMS/secret store, key ownership/rotation, ingress/database TLS evidence, mobile binary analysis and historical credential rotation proof absent |
| Logging, monitoring and retention | 38 | retention schedule, incident/audit schema, tested text redactor, direct stdout prohibition, CI privacy scan | No central structured logger integration, durable India-located 180-day ICT sink, 365-day security target enforcement, alerting, access audit, purge job or restore drill |
| CERT-In readiness | 37 | six-hour/180-day/NTP runbook, schema clocks/states, report/evidence templates | Named PoC/team, India log/NTP proof, current reporting credentials, provider escalation, asset map and tabletop absent |
| DPDP breach readiness | 37 | dual-track runbook, without-delay/72-hour templates, schema clocks and affected-user fields | Named Privacy/DPO contact, Board channel, multilingual user delivery, processor SLA, case tooling and exercise absent; duties are also phased per baseline |
| CI security gates | 64 | Gradle wrapper validation; secret/privacy scans; backend unit/contract/coverage checks and artifacts; frozen Customer/Merchant installs with type/lint/tests; Merchant production audit allowlist and web export | Expo Doctor is documented but not CI-enforced; Customer production audit gate, physical/EAS/deployment gates, SBOM/provenance/signing, exception-expiry automation and branch-protection evidence absent |

## Release-blocking evidence gates

| Gate | Required evidence | Current state |
|---|---|---|
| Regulatory/organisation | approved entity/contact/notice; processing-ground and retention opinions; named DPO/authorised/CERT-In contacts | `LEGAL_ACTION_REQUIRED` / `ORGANISATIONAL_ACTION_REQUIRED` |
| Cloud/data residency | Supabase DB/storage region, grants/network/private bucket, backup window/restore; India ICT log location | `DEPLOYMENT_BLOCKER` |
| Providers/contracts | DPA/terms, countries, subprocessors, breach SLA, deletion/return for each enabled processor | `PROCUREMENT_ACTION_REQUIRED` |
| Production identity | durable OTP/rate limiting, approved SMS provider, recovery/abuse tests, production key store | `IMPLEMENTATION_BLOCKER` |
| Logging/incident | central redaction/structured events, NTP and 180-day India sink, paging, current report access, tabletop | `IMPLEMENTATION_AND_ORGANISATIONAL_BLOCKER` |
| Commerce/payment | durable commerce/outbox, hosted Cashfree integration, signature/replay/idempotency and reconciliation tests | `IMPLEMENTATION_BLOCKER` |
| Mobile/notifications | Expo checks/build fingerprints, signed builds, Android+iOS physical foreground/background/killed/logout/deletion evidence | `PHYSICAL_TEST_BLOCKER` |
| Deletion/retention | scheduled purge and consent propagation jobs, provider deletion, backup restore with tombstone replay | `IMPLEMENTATION_AND_DEPLOYMENT_BLOCKER` |
| Admin/merchant | production IdP/MFA, privileged audit/JIT/access review; deployed storage malware/size/policy tests | `SECURITY_BLOCKER` |

## Evidence index

- Regulatory/source applicability: `INDIA_REGULATORY_BASELINE.md`
- Data: `DATA_INVENTORY.md`, `DATA_FLOW_MAP.md`, `DATA_RETENTION_SCHEDULE.md`, Flyway migrations
- Privacy product: `CONSENT_MODEL.md`, `DATA_PRINCIPAL_RIGHTS.md`, Customer Privacy Centre, privacy domain/controller and API tests
- Security: `SECURITY_ARCHITECTURE.md`, `THREAT_MODEL.md`, `CERTIN_INCIDENT_RESPONSE.md`, `DPDP_BREACH_RESPONSE.md`, security scan and backend/package tests
- Third parties: `DATA_PROCESSOR_REGISTER.md`
- Public language draft: `PRIVACY_NOTICE_ENGINEERING_DRAFT.md`
- Dependencies: `SECURITY_DEPENDENCY_EXCEPTIONS.md`, `docs/qa/CUSTOMER_DEPENDENCY_SECURITY_TRIAGE.md`, Merchant dependency audit workflow

## Evidence integrity

Automated source results must be linked to an immutable commit/CI run. Screenshots, provider settings, contracts, physical-device recordings and incident exercises require owner, date, environment, artifact hash/location and expiry. No row may be changed to `VERIFIED` based only on this document or a local test.

The restored Customer and Merchant SDK 56 projects do not yet have committed, signed EAS build fingerprints. Generate immutable fingerprints and physical-device evidence from the merge commit before release; local source checks are not build attestations.
