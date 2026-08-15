# P5 Checkpoint 3 status

Current state: **SOURCE_CANDIDATE**

This file tracks the certification boundary for the Checkpoint 3 branch.

## Source gate

Checkpoint 3 becomes **CHECKPOINT3_SOURCE_READY** only when the exact final branch head passes:

- backend verification/checks;
- Customer app validation;
- Merchant app validation;
- Cashfree request/webhook contract tests;
- existing Checkpoint 2 JDBC failure/race certification.

## Live gate

Checkpoint 3 becomes **CHECKPOINT3_LIVE_SANDBOX_CERTIFIED** only after real Cashfree sandbox + public staging + physical Android evidence is collected under `P5_CHECKPOINT3_LIVE_SANDBOX_CERTIFICATION.md`.

No source-only PR merge may be described as live sandbox certification.
