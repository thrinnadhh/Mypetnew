# Sprint operations

## Create a contract

Copy an example JSON file and replace the ID, objective, starting SHA, path scope, workers, acceptance statements, and check IDs. The SHA must be the exact clean base commit. Allowed paths are authority boundaries; justifications document expected sensitive changes but do not waive review.

Validate before implementation:

```bash
node engineering/bin/mypet-engineering.mjs contract validate \
  --contract engineering/examples/merchant-barcode-pos.sprint.json
```

## Inspect and verify

Run the scope guard against the contract's starting SHA from a clean working tree. Commit the intended implementation first; dirty or untracked paths block analysis instead of being omitted:

```bash
node engineering/bin/mypet-engineering.mjs scope \
  --contract engineering/examples/merchant-barcode-pos.sprint.json \
  --head HEAD
```

Inspect dependency state without upgrading anything:

```bash
node engineering/bin/mypet-engineering.mjs dependency --base <starting-sha> --head HEAD
```

Inspect suspicious history before replacing code:

```bash
node engineering/bin/mypet-engineering.mjs archaeology --path backend/src/main/kotlin/in/mypetnew/example/Example.kt
```

Plan certification without executing commands (the result must be `NOT_CERTIFIED`):

```bash
node engineering/bin/mypet-engineering.mjs certify --contract <contract.json> --head HEAD
```

Execute the allowlisted relevant checks and write evidence. Explicit `--output` paths, when used, must be JSON files below `evidence/generated/`:

```bash
node engineering/bin/mypet-engineering.mjs certify --contract <contract.json> --head HEAD --run
```

The runner does not install dependencies. A developer or CI job must first prepare the repository using its established Java/npm setup. The isolated Gradle home may require policy-controlled downloads. Certification also requires the requested SHA to be the current clean `HEAD` before and after every check and rejects common ignored environment/credential files. Never interpret `NOT_RUN`, `BLOCKED`, a missing app, or an exit-zero placeholder as passing evidence.

`--run` executes reviewed repository scripts. Run it locally only on code you trust to execute. For pull requests, prefer the disposable, unprivileged CI job; the foundation does not itself provide a container sandbox or deny network access.

## Run toolkit evals

```bash
./scripts/verify-engineering-toolkit.sh
```

CI runs only this deterministic, offline suite. It does not call models or MCP servers and does not duplicate full product builds. The workflow uploads only the two explicit contract-validation reports; security-check output is not part of that artifact.

The wrapper enforces at least 80% line and function coverage for the dependency-free Node toolkit.
