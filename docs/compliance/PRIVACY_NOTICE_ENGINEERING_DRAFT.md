# Privacy notice — engineering draft

Status: `LEGAL_REVIEW_REQUIRED`. Do not publish this draft. Replace organisational placeholders, confirm processing grounds/retention/transfers and provide approved Indian-language versions before release.

## Who is responsible

`[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]` operates MyPet and is responsible for the personal data described here. Privacy/grievance contact: `[APPROVED EMAIL/POSTAL/PHONE]`. Data Protection Officer or authorised contact, if applicable: `[APPROVED DETAILS]`.

## What MyPet currently collects

- Mobile number for OTP sign-in; temporary OTP security state; account/session/device identifiers.
- Optional display name and email. For adult products, an adult-eligibility attestation timestamp—not date of birth.
- Cart, order, product, pricing, payment-provider reference/status and refund/reconciliation facts when commerce is production-enabled. MyPet must not collect or store full card number, CVV, UPI PIN or bank password.
- Merchant organisation/outlet, catalogue and private verification evidence for authorised merchant/admin workflows.
- Loyalty account, points ledger and redemption facts scoped to a merchant organisation.
- Notification preference, encrypted device push token and delivery outcome. Lock-screen messages are designed to omit sensitive details.
- Consent/withdrawal proof, privacy/rights/grievance requests, security/audit and incident records.

The current source does **not** implement customer GPS/address tracking, veterinary/medical records, analytics/advertising, production payments, production SMS, maps or captain delivery details. Update this notice and obtain any required consent before enabling such processing.

## Why it is used

MyPet uses data to authenticate and secure accounts; provide user-requested shopping, merchant, loyalty and notification functions; prevent abuse and investigate incidents; support, correct and delete accounts; respond to rights/grievances; reconcile transactions; and meet applicable legal duties. Legal must map each purpose to a permitted processing ground. Optional location, notifications, marketing, personalisation, product analytics and recurring reminders require separate, default-off choices where consent is relied on.

## Choice and withdrawal

The Privacy Centre shows optional purposes separately and records the notice version and time. A person can withdraw an optional purpose through the same centre. Withdrawal stops future optional processing once propagation completes; it does not make earlier lawful processing unlawful or erase records that must be retained for an approved legal purpose. No optional marketing choice is required to use core service.

## Sharing and processing locations

The source anticipates Supabase PostgreSQL/private storage and Firebase Cloud Messaging. Expo/EAS and GitHub may process build/source metadata; OTP, payment, maps, monitoring and support providers are not selected/integrated. Actual entities, countries/regions, retention, subprocessors and transfer safeguards are not yet verified and must be inserted from `DATA_PROCESSOR_REGISTER.md` before publication. MyPet does not sell personal data in this design.

## Retention and deletion

Data is kept only for the approved purpose and schedule. OTP state expires in minutes; access tokens are short-lived; refresh sessions expire or are revoked; push registrations are revoked on logout/deletion. Account deletion disables access and erases direct identifiers, profile and cart while approved transaction/audit records may remain pseudonymous for a defined legal period. Backup restores must reapply deletion tombstones. Final periods require legal/provider confirmation; see `DATA_RETENTION_SCHEDULE.md`.

## Security

The design uses a server-only database boundary, role/ownership checks, protected mobile token storage, rotating refresh sessions, encrypted FCM tokens, private object access and CI security checks. No system is risk-free. Production key management, cloud controls, contracts, monitoring and physical-device evidence remain release gates.

## Rights and grievance

Authenticated Customers can view a summary, correct profile data, manage optional consent, submit access/correction/erasure/grievance/nomination requests and delete their account from the Privacy Centre. Alternative verified channels and approved contact details must be added. The case team will verify identity, respond within the applicable period, explain any lawful restriction and provide escalation information.

## Children and adult products

The service is designed for adults and requires an adult-eligibility attestation before customer sign-in. It does not intentionally request date of birth. This control does not by itself establish a legally adequate child-verification/parental-consent process; child access policy and age-assurance risk must be approved before production.

## Personal data breaches

If a personal data breach occurs, MyPet will investigate, contain it and send notices to affected people and authorities as required, using plain language and practical protective steps. MyPet will never ask for an OTP, password, CVV or UPI PIN in a breach notice.

## Notice changes

Each approved notice is immutable and versioned. Material new purposes, data, processors, transfers or retention require prior privacy/legal review, a revised notice and fresh consent where applicable. Publication date, effective date and version: `[LEGAL_ACTION_REQUIRED]`.

