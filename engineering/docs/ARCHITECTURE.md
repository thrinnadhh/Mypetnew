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

Policy, deterministic verification, model reasoning, and tool execution are separate. The deterministic layer has no AI/provider dependency and makes no network request.

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

Certification is fail-closed. A required check must have an exit code, duration, exact-head SHA, output artifact, and SHA-256 digest. Missing, stale, blocked, or failed evidence yields `NOT_CERTIFIED`. Local reports help review; merge eligibility should ultimately rely on protected exact-head CI.

## Security properties

- Child processes use argv arrays and `shell: false`.
- Executables, working directories, timeouts, and check IDs are reviewed in the catalog.
- Working directories and report paths must resolve inside the repository.
- Only a small runtime environment allowlist is passed; sprint data cannot add environment keys.
- Known credential-shaped output is redacted and logs are created mode `0600` locally.
- Git revisions and paths are validated and passed after `--` where applicable.
- No repository source, `.env`, or report is uploaded by the toolkit.

Prompt path restrictions are not a security boundary. A production worker broker must enforce filesystem and capability policy independently.
