# India regulatory baseline

Status: engineering baseline, not legal advice  
Verified: 2026-08-15  
Publication rule: only Government of India and regulator sources are authoritative in this document.

## Current DPDP commencement position

G.S.R. 843(E), dated 13 November 2025 and published on 14 November 2025, phases the Act:

- in force from publication: section 1(2), section 2, sections 18–26, 35, 38–43 and section 44(1), (3);
- scheduled one year after publication (14 November 2026): section 6(9) and section 27(1)(d);
- scheduled eighteen months after publication (14 May 2027): sections 3–5, section 6(1)–(8), (10), sections 7–17, most of section 27, sections 28–34, 36–37 and section 44(2).

The final Rules have a matching phased structure: Rules 1, 2 and 17–21 are in force; Rule 4 is scheduled for the one-year phase; Rules 3, 5–16, 22 and 23 are scheduled for the eighteen-month phase. The Data Protection Board was established by G.S.R. 844(E). MyPet nevertheless targets the final operational controls now. Because DPDP Act section 44(2), which omits IT Act section 43A, is in the eighteen-month phase, this baseline treats section 43A/SPDI as part of the current transition floor. Counsel must confirm the calculated dates and the effect of the 16 December 2025 Rules corrigendum before production sign-off.

## Requirement register

| Authority and exact provision | Commencement on verification date | Engineering implication | Repository component | Status and evidence | Open interpretation |
|---|---|---|---|---|---|
| DPDP Act 2023 ss. 4–7 | Scheduled 18-month phase | Lawful, purpose-limited processing; standalone notice; free/specific consent; comparable withdrawal | privacy API/mobile centre; consent table | PARTIAL — `PrivacyService`, `PrivacyController`, `privacy_consent`, Customer Privacy Centre | LEGAL_REVIEW_REQUIRED: final notices, necessary-use analysis and pre-commencement consent migration |
| DPDP Act s. 8(1)–(8), (10) | Scheduled 18-month phase | Fiduciary accountability, processor contracts, accuracy, security, breach and erasure | backend, processors, deletion | PARTIAL — session/device revocation, direct-identifier erasure, processor register; deployed controls unverified | LEGAL/PROCUREMENT_ACTION_REQUIRED for each DPA and breach SLA |
| DPDP Act s. 9 | Scheduled 18-month phase | Verifiable parental consent for child processing; no prohibited tracking/targeted ads | identity and Customer UI | PARTIAL — adult attestation without DOB; product policy excludes child accounts | LEGAL_REVIEW_REQUIRED: proportional age assurance and exemptions |
| DPDP Act s. 10 | Scheduled 18-month phase | Significant Data Fiduciary duties if notified | governance | BLOCKED — no notification/status evidence | LEGAL_REVIEW_REQUIRED: monitor notification and scale/risk criteria |
| DPDP Act ss. 11–14 | Scheduled 18-month phase | Access, correction/update, erasure, grievance and nomination; portability is not stated | privacy APIs/UI | PARTIAL — authenticated summary and request lifecycle implemented; fulfilment operations not staffed | LEGAL_REVIEW_REQUIRED: identity evidence and nomination procedure |
| DPDP Act s. 16 | Scheduled 18-month phase | Transfers permitted subject to notified restrictions and stronger sector laws | processor register | PARTIAL — unknown regions are blocked, not inferred | LEGAL_REVIEW_REQUIRED on any notified restricted country/order |
| DPDP Rules 2025 r. 3 | Scheduled 18-month phase | Itemised, standalone, clear notice; direct links for withdrawal/rights/complaint | consent model/UI | PARTIAL — purpose notices implemented in Customer UI; counsel-approved multilingual notice absent | Counsel review before publication |
| DPDP Rules r. 6 | Scheduled 18-month phase | Encryption/masking, access control, logs, monitoring, backup and one-year security evidence; processor clauses | backend/infra/contracts | PARTIAL — encrypted FCM tokens, hashed refresh/OTP, access checks, redaction gates; deployed storage/log/backup evidence absent | LEGAL_REVIEW_REQUIRED: scope of r. 6(1)(e) personal data retained with logs |
| DPDP Rules r. 7 | Scheduled 18-month phase | Affected-person notice without delay; immediate Board initial notice and details within 72 hours | incident runbook/schema | PARTIAL — dual clocks and templates documented; operational paging/report channel untested | Counsel/incident commander determines notification content |
| DPDP Rules r. 8(3), Seventh Schedule | Scheduled 18-month phase | At least one-year retention of specified processing data/traffic/logs for scheduled purposes, then erasure unless law requires more | retention architecture | PARTIAL — 365-day security/audit target, not blanket Customer retention | LEGAL_REVIEW_REQUIRED: exact records within r. 8(3) and interaction with data minimisation |
| DPDP Rules rr. 9, 14 | Scheduled 18-month phase | Publish responsible contact and rights/grievance mechanism; grievance period no more than 90 days | privacy notice/centre | PARTIAL — mechanism exists; company contact and published service period are placeholders | LEGAL/ORG_ACTION_REQUIRED to appoint contact; current SPDI one-month grievance floor retained |
| DPDP Rules rr. 10–12 | Scheduled 18-month phase | Child/guardian verification and exemptions | identity/product | NOT_APPLICABLE_WITH_REASON for intended adult-only accounts; control blocks un-attested login | Any decision to admit children requires a new parental-consent design before launch |
| DPDP Rules r. 15 | Scheduled 18-month phase | Cross-border transfer subject to Government requirements | processor register | BLOCKED pending processor regions/contracts | Monitor Government orders |
| IT Act 2000 s. 43A and s. 87(2)(ob) | In force during transition; omission scheduled with DPDP s. 44(2) | Reasonable security for human SPDI and compensation exposure | security programme | PARTIAL — documented programme and controls; independent audit absent | LEGAL_REVIEW_REQUIRED on transition and entity applicability |
| IT Act ss. 70B(4), (6), (7) | In force | CERT-In directions, assistance and sanctions for non-compliance | incident response/logs | PARTIAL — runbook and clocks exist; PoC/India log platform unverified | Named PoC and deployment evidence required |
| IT Act ss. 72, 72A | In force | Prevent unauthorised disclosure and contractual misuse | least privilege, DTOs, audit | PARTIAL — role DTOs and no raw entities; production persistence incomplete | Counsel to map contractual confidentiality duties |
| SPDI Rules 2011 rr. 3–5 | In force during transition | Human financial/password/health/medical/biometric data; privacy policy, necessary collection, consent, correction, withdrawal, grievance within one month | notice, privacy centre, security | PARTIAL — mechanisms exist; public contact/policy not approved | Pet health is not automatically human medical SPDI; Customer-linked veterinary data is RESTRICTED by internal policy |
| SPDI Rules rr. 6–8 | In force during transition | Third-party disclosure, comparable transfer protection, documented security programme and periodic independent audit | processors/security | PARTIAL — register/checklist exists; contracts/independent audit blocked | LEGAL/PROCUREMENT_ACTION_REQUIRED |
| CERT-In Directions 28-04-2022 (i)–(iv) and Annexure I | In force (directions effective after stated 60 days) | NTP traceability; report listed incidents within six hours; PoC; securely keep ICT logs 180 days within India | CERT-In runbook/log architecture | PARTIAL — runbook/state machine; deployment, PoC and reporting drill absent | Annexure must be checked at incident time; do not hard-code a stale category list |
| CERT-In Secure Application Guidelines and API Security whitepaper (14-08-2023) | Current regulator guidance, not a separate statutory cause of action identified here | SDLC, API authorization, secrets, validation, logging, testing | backend/mobile/CI | PARTIAL — role/owner tests, CI gates, secret scan, DTOs; DAST/VAPT absent | External CERT-In-empanelled audit is release action |
| Consumer Protection Act 2019 ss. 2, 17–21 | In force from notified 2020 dates | Consumer information, unfair practices, misleading representations and CCPA powers | commerce/UI/support | PARTIAL — fee fields are canonical; complete checkout/refund/grievance UI not implemented | Legal review of marketplace role and seller obligations |
| Consumer Protection (E-Commerce) Rules 2020 rr. 4–7, amended 2021 | In force | Entity/seller identity, grievance, refund/return, payment and total-price/charge disclosure; India-resident nodal officer where applicable | commerce/admin/privacy | PARTIAL — quote contains platform/delivery/commission amounts; production confirmation screens absent | LEGAL/ORG_ACTION_REQUIRED for grievance/nodal officer and corporate disclosures |
| CCPA Dark Patterns Guidelines 2023 rr. 3–5 and Annexure | In force from Gazette publication | No deceptive UX, false urgency, basket sneaking, confirm shaming, forced action, subscription trap or disguised ads | Customer UI | PARTIAL — consents default off and recurring reminders state no automatic purchase; full journey review blocked | Product/legal review of every production experiment |
| RBI CoFT circular 07-09-2021 para 4 and PA/PG guidelines | In force | MyPet/merchant must not store actual card data; only limited references/last four where allowed; hosted/tokenised provider flow | payment boundary/CI scan | VERIFIED for current repository absence — no payment credential model; CI forbids card/CVV/UPI PIN fields | Cashfree contract/config and webhook implementation are not present and remain blocked |

## Primary sources

- [DPDP Act 2023, official Gazette PDF](https://www.meity.gov.in/static/uploads/2024/02/Digital-Personal-Data-Protection-Act-2023.pdf)
- [DPDP Act commencement, G.S.R. 843(E)](https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf)
- [DPDP Rules 2025, G.S.R. 846(E)](https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf)
- [MeitY final Rules collection, including corrigendum](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa)
- [IT Act 2000, India Code](https://www.indiacode.nic.in/bitstream/123456789/1999/1/A2000-21%20%281%29.pdf)
- [SPDI Rules 2011, India Code](https://upload.indiacode.nic.in/showfile?actid=AC_CEN_45_76_00001_200021_1517807324077&filename=GSR313E_10511%281%29_0.pdf&type=rule)
- [CERT-In Directions and current FAQ index](https://www.cert-in.org.in/Directions70B.jsp)
- [CERT-In Directions PDF](https://www.cert-in.org.in/PDF/CERT-In_Directions_70B_28.04.2022.pdf)
- [CERT-In Application Security Guidelines](https://www.cert-in.org.in/PDF/Application_Security_Guidelines.pdf)
- [CERT-In API Security whitepaper](https://www.cert-in.org.in/PDF/CIWP-2023-0001.pdf)
- [Consumer Protection official Act/rules collection](https://consumeraffairs.nic.in/acts-and-rules/consumer-protection/consumer-protection)
- [E-Commerce Rules 2020](https://consumeraffairs.nic.in/sites/default/files/E%20commerce%20rules_0.pdf)
- [E-Commerce Amendment Rules 2021](https://consumeraffairs.nic.in/sites/default/files/Consumer%20Protection%20%28E-Commerce%29%20%28Amendment%29%20Rules%2C%202021.pdf)
- [CCPA Dark Patterns Guidelines 2023](https://consumeraffairs.nic.in/sites/default/files/The%20Guidelines%20for%20Prevention%20and%20Regulation%20of%20Dark%20Patterns%2C%202023.pdf)
- [RBI Card-on-File Tokenisation circular](https://www.rbi.org.in/scripts/BS_CircularIndexDisplay.aspx?Id=12159)

## Mandatory legal decisions before production

`LEGAL_REVIEW_REQUIRED`: identify the Data Fiduciary legal entity; approve notices/terms; determine marketplace/inventory obligations; appoint and publish grievance/privacy contacts; validate DPDP transition dates/corrigendum; decide age-assurance evidence; determine statutory order/payment/tax retention; assess whether MyPet is an intermediary; review every cross-border transfer and processor agreement; monitor SDF and transfer notifications.
