# P5 Checkpoint 3 status

Current source state: **CHECKPOINT3_SOURCE_READY**

Live sandbox state: **NOT YET CERTIFIED**

Checkpoint 3 source readiness means the repository contains the current Cashfree provider contract, sandbox preflight, live certification runbook, read-only evidence harness, contract tests, and Checkpoint 2 adversarial protections. It does not mean a real Cashfree sandbox transaction has been executed.

## Source gate

The source-ready state is valid only for an exact commit that passes:

- backend verification/checks;
- Customer app validation;
- Merchant app validation;
- Cashfree request/webhook contract tests;
- existing Checkpoint 2 JDBC failure/race certification;
- syntax validation for the P5 sandbox preflight and Checkpoint 3 evidence scripts.

Any later source change requires a fresh exact-head gate before merge or certification.

## Live gate

Checkpoint 3 becomes **CHECKPOINT3_LIVE_SANDBOX_CERTIFIED** only after real Cashfree sandbox + public staging + physical Android evidence is collected under `P5_CHECKPOINT3_LIVE_SANDBOX_CERTIFICATION.md`.

No source-only PR merge may be described as live sandbox certification.
