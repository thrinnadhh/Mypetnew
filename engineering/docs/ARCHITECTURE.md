# Autonomous engineering foundation

## Purpose

The toolkit makes future MyPetNew sprints inspectable, scoped, and evidence-based. It does not implement a model runtime and it does not replace the repository's existing Gradle, npm, Expo, security, migration, or CI checks. It selects those checks by reviewed IDs and records their actual results.

Repository truth at foundation start (`bc4736172ad55879a2c4aed53918ecb533c3a36f`) was Kotlin/Spring Boot, PostgreSQL/Flyway, and three independent Expo apps: Customer, Merchant, and Captain. No Admin application or Next.js configuration was tracked. The root README was stale and was deliberately not used as discovery truth.

## Boundaries

```text
model/human judgment
        ↓
Advisor / Orchestrator / Worker policies
        ↓
validated JSON sprint contract
        ↓
Git diff ──→ scope guard ─────────┐
         ├─→ dependency doctor ───┤
         └─→ check selector/runner├─→ certifier → JSON report
Git history → archaeology report ─┘
```

Policy, deterministic analysis, model reasoning, and tool execution are separate. The analysis layer has no AI/provider dependency and makes no network request. Reviewed product checks run through the separate execution layer and may require policy-controlled network access.

## Why `engineering/`

The repository already has domain-specific machine-readable Merchant Operations contracts and validators. Those remain authoritative for that program and are consumed as existing checks. A root `engineering/` namespace keeps generic sprint governance separate from product code and avoids turning a domain contract into an unrelated global schema. Dependency-free Node `.mjs` and `node:test` match existing script conventions and CI's Node 22 runtime; no root workspace or new third-party package was introduced.

## Contract and worker authority

The JSON Schema documents the portable shape. The semantic validator additionally rejects unsafe repository patterns, worker paths outside sprint paths, unknown fields, malformed SHA values, duplicate/self-referencing workers, and changed forbidden paths. Contracts reference check IDs only. They cannot provide commands, environment values, or tool endpoints.

Worker briefs are the validated worker objects. In a future adapter, effective capabilities are:

```text
worker contract ∩ role policy ∩ environment adapter capabilities
```

Everything else is denied.

## Reports and evidence

Generated artifacts belong under `evidence/generated/engineering/<sprint>/<head>/`, which is already ignored. Reports distinguish deterministic facts from heuristics. Scope classifications are `IN_SCOPE`, `JUSTIFICATION_REQUIRED`, and `LIKELY_SCOPE_CREEP`. Commit messages and co-change frequency are signals, not proof of intent or dependency.

Certification is fail-closed. Scope analysis and certification require a clean working tree so uncommitted or untracked changes cannot disappear from the evidence range. Common ignored environment and credential configuration (`.env*`, `.npmrc`, `.yarnrc*`, `local.properties`, and `settings.xml`) is also rejected during check execution. A required check must have an exit code, duration, exact-head SHA, output artifact, and SHA-256 digest, and the in-process certifier accepts only result objects created by its runner. Missing, stale, blocked, fabricated, or failed evidence yields `NOT_CERTIFIED`. Local reports help review; merge eligibility should ultimately rely on protected exact-head CI.

## Security properties

- Child processes use argv arrays and `shell: false`.
- Executables, working directories, timeouts, and check IDs are reviewed in the catalog.
- Working directories and report paths must resolve inside the repository.
- Only a small runtime environment allowlist is passed; sprint data cannot add environment keys.
- Reviewed catalog checks persist only generic pass/fail summaries in mode-`0600` atomic files. Raw command and nested secret-scanner output is never written to evidence.
- Git revisions and paths are validated and passed after `--` where applicable.
- The local CLI performs no uploads. The included CI workflow uploads only the two explicit contract-validation JSON reports as build artifacts; it does not upload repository source, `.env` files, or raw check logs.

Prompt path restrictions are not a security boundary. A production worker broker must enforce filesystem and capability policy independently.

## Known limitations

- Dependency inspection is deterministic manifest/lockfile/build-file analysis. It flags drift and suspicious declarations; it does not prove semantic reachability or safely auto-remove packages.
- Git archaeology provides bounded commit-message, co-change, and blame signals. Those are review clues, not proof of ownership, intent, or causality.
- The policy documents define model-neutral roles and MCP routing, but this foundation does not ship a model runtime, MCP broker, container sandbox, or network-isolation layer.
- Process-group termination covers normal completion, timeout, output-limit termination, and parent `SIGINT`/`SIGTERM` handling. It remains best effort across operating systems; a process that deliberately creates a new session requires a container or OS sandbox boundary.
- Reviewed commands still execute repository-controlled scripts. Use local `--run` only for code you trust to execute; authoritative pull-request evidence belongs on a disposable, unprivileged CI runner with no application or production secrets. This foundation does not provide OS-level filesystem or network isolation.
- Local ignored dependency trees and arbitrary ignored non-configuration files can still influence project commands. Protected CI should provision dependencies into a fresh checkout from reviewed lockfiles.
- The isolated Gradle home is intentionally empty to avoid inheriting credentials or init scripts; a backend check may need policy-controlled network access to populate it.
- An independently protected CI run is stronger evidence than local certification performed by the same actor that made the change.
- No Admin application is present in repository truth at the foundation SHA, so no Admin-specific command is fabricated.
