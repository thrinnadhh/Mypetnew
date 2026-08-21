# Merchant Operations program contracts

These files provide machine-readable delivery traceability for M0–M13. They are
CI inputs, not runtime business configuration.

- `invariants.json` assigns stable architecture invariant IDs.
- `sprint-dependencies.json` defines dependency closure.
- `test-obligations.json` records required evidence owned by each sprint.
- `program-state.json` lists only sprints that have passed their exit gate.
- `sealed-flyway-v21.sha256` protects the migration history audited by M0.

An incomplete sprint may own `PLANNED` obligations. A sprint cannot be added to
`completedSprints` until every obligation it owns is `ENFORCED` and references
real, enabled evidence files. Production code must never read these contracts.
