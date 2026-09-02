# Sprint operations

## Create a contract

Copy an example JSON file and replace the ID, objective, starting SHA, path scope, workers, acceptance statements, and check IDs. The SHA must be the exact clean base commit. Allowed paths are authority boundaries; justifications document expected sensitive changes but do not waive review.

Validate before implementation:

```bash
node engineering/bin/mypet-engineering.mjs contract validate \
  --contract engineering/examples/merchant-barcode-pos.sprint.json
```

## Inspect and verify

Run the scope guard against the contract's starting SHA:

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

Execute the allowlisted relevant checks and write evidence:

```bash
node engineering/bin/mypet-engineering.mjs certify --contract <contract.json> --head HEAD --run
```

The runner does not install dependencies. A developer or CI job must first prepare the repository using its established Java/npm setup. Never interpret `NOT_RUN`, `BLOCKED`, a missing app, or an exit-zero placeholder as passing evidence.

## Run toolkit evals

```bash
./scripts/verify-engineering-toolkit.sh
```

CI runs only this deterministic, offline suite. It does not call models or MCP servers and does not duplicate full product builds.
