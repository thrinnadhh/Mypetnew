# CERT-In incident response runbook

Status: engineering runbook, 2026-08-15. The Incident Commander and Legal must use the current CERT-In directions, methods and incident list at event time. This is not a substitute for regulatory advice.

## Non-negotiable clocks

- Synchronise all production ICT systems with NIC/NPL-traceable time sources (or an accurate standard traceable to them). Record UTC internally and preserve original timezone.
- Report a listed cyber incident to CERT-In within **six hours of noticing it or it being brought to MyPet's notice**. Do not wait for root cause or perfect counts. Send what is known, label estimates, and supplement.
- Designate and maintain the CERT-In Point of Contact in the prescribed form.
- Keep ICT logs securely for a rolling **180 days within Indian jurisdiction** and provide them when lawfully directed. Application/business retention may be longer, but this minimum and location require deployment evidence.

Primary direction: [CERT-In Directions under section 70B](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf). Current forms and FAQs: [CERT-In directions page](https://www.cert-in.org.in/Directions70B.jsp).

## Roles and contacts

| Role | Responsibility | Named person / contact |
|---|---|---|
| Incident Commander | owns severity, containment and record | `ORGANISATIONAL_ACTION_REQUIRED` |
| CERT-In Point of Contact | six-hour report and supplements | `ORGANISATIONAL_ACTION_REQUIRED` |
| Security/SRE | evidence, scope, containment, recovery | `ORGANISATIONAL_ACTION_REQUIRED` |
| Privacy/DPO contact | personal-data assessment and user/Board track | `LEGAL_ACTION_REQUIRED` |
| Legal | reporting classification, privilege, law enforcement and holds | `LEGAL_ACTION_REQUIRED` |
| Communications/support | approved affected-person messaging | `ORGANISATIONAL_ACTION_REQUIRED` |
| Provider liaison | emergency notices and evidence from Supabase/Firebase/others | Per processor register; currently incomplete |

The contact sheet, reporting credentials and an offline copy of this runbook must be accessible during an identity/cloud outage. Quarterly verification and an annual exercise are required.

## State machine and clocks

Use `mypet.security_incident`: `DETECTED → TRIAGED → REPORTABLE_CERTIN` when the incident matches the CERT-In list; containment/recovery may proceed in parallel: `CONTAINED → ERADICATED → RECOVERED → POSTMORTEM_COMPLETE`. `DPDP_PERSONAL_DATA_BREACH` starts a separate DPDP track and does not replace CERT-In classification.

At detection, set `incident_detected_at`. At the first moment the organisation or its processor brings facts to an authorised responder, set immutable `became_aware_at` and calculate `cert_in_deadline = became_aware_at + 6 hours`. Never reset the clock when severity or scope changes. Record every decision and reporter.

## First six hours

1. Open a restricted incident record; appoint Incident Commander; preserve original alerts, request IDs, UTC times, asset IDs and hashes. Do not paste raw tokens or unnecessary personal data into tickets.
2. Triage impact and compare against the current CERT-In reportable incident list. Treat unauthorised access/data breach, attacks on applications/APIs/cloud, identity compromise, malicious mobile apps, significant outages and relevant payment events as immediate legal/security review triggers.
3. Contain safely: revoke compromised credentials and sessions, isolate affected service/project, stop malicious traffic and preserve evidence. Do not destroy logs or wipe assets before forensic capture.
4. Notify processor emergency contacts and request evidence, access logs, regions, timestamps, actions and subprocessor impact. A provider notification does not satisfy MyPet's reporting duty.
5. If reportable or uncertain close to deadline, submit the initial CERT-In report via a current accepted channel before the deadline. Record delivery acknowledgement and `cert_in_reported_at`.
6. Start the DPDP personal-data-breach runbook whenever personal data may be affected. Both tracks run independently.

## Initial report template

Subject: `Initial cyber incident report — MyPet — <incident-id> — <UTC timestamp>`

- Reporting entity, registered address and sector: `ORGANISATIONAL_ACTION_REQUIRED`
- CERT-In Point of Contact and 24x7 callback: `ORGANISATIONAL_ACTION_REQUIRED`
- Incident ID, detection/awareness time with timezone, six-hour deadline
- Incident type and why it may match the reportable list
- Affected applications, cloud accounts, domains, public IPs and regions
- Known timeline, indicators of compromise and attack vector
- Known/estimated affected records/users and data categories; explicitly identify uncertainty
- Business/service impact and any payment/critical dependency impact
- Containment already taken and planned next action
- Providers/third parties engaged
- Law-enforcement/other regulator notice, if any
- Evidence available and safe transfer method
- Next update time; statement that the report is preliminary

Do not send passwords, OTPs, private keys, raw bearer tokens or full payment credentials. Use CERT-In's current secure submission method for evidence.

## Evidence preservation and recovery

- Export relevant immutable/cloud audit, gateway, identity, database, object access, FCM/provider and CI/deployment logs. Record collector, source, command/method, time range, SHA-256 and custody transfer.
- Validate time skew. Preserve configuration, images and suspect artifacts. Document every containment change.
- Recover from a known-good version, rotate affected secrets/keys, invalidate sessions/tokens, reapply deletion tombstones after database restore, and verify negative authorization and notification tests.
- Supplement CERT-In promptly as scope/root cause changes. Record `cert_in_reported_at`, each supplement and acknowledgement.
- Complete a blameless postmortem with control owner/due date, update threat model/tests, and retain the incident record under the approved schedule.

## Current blockers

Named roles/contact channels, India-located 180-day log storage, NTP evidence, provider emergency SLAs, immutable case workflow, production asset/register mapping, secure evidence transfer and a completed tabletop are absent. Production readiness is blocked until evidence is attached to the compliance matrix.

