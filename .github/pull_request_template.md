## Sprint identity

- Sprint ID:
- Verified base `main` SHA:
- Verified predecessor merge SHA:
- Schema version before / after:

## Contract and scope

- Invariant/test-obligation IDs activated:
- API contracts changed:
- Explicit non-goals:
- Customer compatibility impact:
- Offline behavior impact:

## Required evidence

- [ ] Tenant/outlet negative tests are present or genuinely not applicable with reason.
- [ ] Idempotency/retry/unknown-outcome tests are present or genuinely not applicable with reason.
- [ ] Concurrency tests assert final state/effect counts or are genuinely not applicable with reason.
- [ ] New schema work uses a forward migration; no historical migration was edited.
- [ ] Clean-install and upgrade-path migration evidence is attached when schema changes.
- [ ] Merchant process-death/offline evidence is attached when local state changes.
- [ ] Customer stale-price/availability compatibility is tested when public commerce changes.
- [ ] No skipped, focused, fabricated, or unexecuted test is claimed as success.
- [ ] Adversarial review was performed and findings were repaired or documented.
- [ ] Physical Android evidence is attached when the sprint requires camera/barcode/native certification.

## Exact-head validation

- Final PR head SHA:
- `ci / verify-backend`:
- `validate-merchant / merchant-app`:
- `validate-restored-customer / customer-app`:
- `merchant-operations-contract / program-contract`:
- Other applicable checks:

## Failures, repairs, and blockers

List observed failures, root causes, repairs, retests, and genuine external blockers. Do not describe a blocked or skipped command as passed.
