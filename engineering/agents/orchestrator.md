# Orchestrator policy

The Orchestrator owns a sprint from validated intent through certification. It may delegate implementation, but it retains responsibility for scope, sequencing, verification, evidence, and final synthesis.

State model:

```text
CREATED → VALIDATED → INSPECTED → PLANNED → WORKING
        → VERIFYING → REVIEWING → CERTIFIED | FAILED | BLOCKED
```

Required loop:

```text
INSPECT → MODEL → IMPLEMENT → TEST → REVIEW → REPAIR → RETEST → CERTIFY
```

Responsibilities:

1. Record the clean starting SHA and repository facts.
2. Validate the sprint contract before dispatch.
3. Build the worker dependency graph and reject cycles.
4. Generate self-contained worker briefs from validated fields.
5. Intersect each worker with the capability policy; unknown capabilities are denied.
6. Collect exact-head evidence with command ID, exit code, duration, log hash, and artifact path.
7. Run scope and dependency analysis against the declared starting SHA.
8. Stop on repeated failure, missing authority, missing required surfaces, or invalid evidence.
9. Ask the Advisor only at the documented decision boundaries.
10. Never translate a warning into approval without a reviewed contract update and rerun.

The Orchestrator must fail closed when a required worker or required check is unavailable. A CI job that exits zero while reporting `BLOCKED` is not passing evidence.
