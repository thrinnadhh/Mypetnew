# DPDP personal data breach response runbook

Status: advance engineering preparation, 2026-08-15. Most operational duties in the Digital Personal Data Protection Act, 2023 and Rules, 2025 are phased to commence later; the implementation calendar is recorded in `INDIA_REGULATORY_BASELINE.md`. Legal must verify the law, Board channel and required content at incident time.

This track begins for any unauthorised processing of personal data, accidental disclosure, acquisition, sharing, use, alteration, destruction or loss of access that compromises confidentiality, integrity or availability. It runs alongside CERT-In response; neither notification substitutes for the other.

## Clocks

Set immutable `became_aware_at` when MyPet or a processor first provides enough facts to reasonably identify a possible personal data breach. Immediately assign Privacy/Legal. Under the notified Rules design, notify each affected Data Principal **without delay** in clear and concise language and provide the Board an initial intimation **without delay**, followed by fuller information within **72 hours** unless the Board allows more time. The six-hour CERT-In clock may be earlier and remains separate.

The incident schema records `dpdp_board_deadline`, `affected_users_notified_at` and `board_reported_at`. For readiness exercises set `dpdp_board_deadline = became_aware_at + 72 hours`, but do not misread that as permission to delay initial notice.

Primary texts: [DPDP Act, 2023](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf), [DPDP Rules, 2025 notification](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf), and [commencement notification](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf).

## Response workflow

1. Open/restrict the incident record and preserve evidence. Identify affected systems, purposes, data classes, persons, countries/processors, first/last exposure, confidentiality/integrity/availability impact and whether deleted-person data was restored.
2. Contain without destroying evidence: revoke access/session/device tokens, restrict queries/exports, isolate projects, rotate secrets and stop unsafe notifications or provider transfers.
3. Set status `DPDP_PERSONAL_DATA_BREACH`; appoint Privacy/Legal owner; calculate all clocks. Notify the CERT-In owner for parallel classification.
4. Build a deduplicated affected-person list using the minimum necessary data and a secure delivery channel. Do not omit affected persons merely because risk appears low unless current law/legal advice expressly permits it.
5. Send the clear affected-person notice without delay. Offer concrete protective steps and a working contact/grievance channel. Avoid speculation, minimisation, promotional language or dark patterns.
6. Send the Board initial intimation without delay using the then-current prescribed channel. Preserve acknowledgement.
7. Continue investigation, mitigation and provider coordination. Within 72 hours provide updated nature/extent/timing/location, likely impact, measures taken/planned, findings on the responsible actor if known, remediation to prevent recurrence, affected-person notices, and contact information. Request an extension before expiry if necessary and permitted.
8. Recover and verify: access/session revocation, direct identifier protection, restored tombstones, least privilege, provider deletion and safe notification content. Supplement users/Board when material facts change.
9. Close only after recovery, communications, corrective actions and postmortem ownership are recorded.

## Affected Data Principal notice template

Subject: `Important security notice about your MyPet data`

- What happened, stated in plain language, including known time period
- What personal data and account functions were affected
- Likely consequences specific to the incident
- What MyPet has done and is doing
- Actions the person can take (for example reauthenticate, distrust OTP requests, contact their bank only if relevant)
- Confirmation that MyPet will never ask for an OTP, password, CVV or UPI PIN
- Privacy/grievance contact, accessible channels and incident reference
- Date/time of notice and where trustworthy updates will appear

Do not expose other people, raw logs, exploit details that increase risk, or unverified blame. Provide accessible language versions appropriate to the audience.

## Board initial/update template

- Data Fiduciary identity/address/contact and authorised Privacy/DPO contact
- Incident ID; detection and awareness times; report time; requested extension if any
- Nature, extent, timing and location; affected systems/processors/countries
- Categories and estimated number of affected Data Principals/records, with uncertainty stated
- Likely consequences and risk analysis
- Containment, mitigation, recovery and evidence preservation
- Notifications to affected persons, CERT-In, law enforcement and processors
- Cause/threat actor findings if known; corrective measures and owners
- Secure channel for supporting evidence and next-update time

## Current blockers

Named authorised Privacy/DPO contact, public grievance details, Board reporting account/channel, user communication service, multilingual templates, processor breach SLAs, case workflow and an exercised 72-hour evidence package are absent. The schema and runbook alone do not satisfy the future duty.

