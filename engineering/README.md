# MyPetNew engineering-agent toolkit

This directory contains a provider-neutral sprint contract, Advisor/Orchestrator/Worker policies, deterministic scope/dependency/Git analysis, evidence-based certification, executable evals, and the design for future least-capability MCP routing.

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), then [docs/OPERATIONS.md](docs/OPERATIONS.md). Contract examples are under `examples/`; schemas and reviewed command/capability policy are under `schemas/` and `policies/`.

Quick verification:

```bash
./scripts/verify-engineering-toolkit.sh
```

The toolkit does not modify product functionality, auto-upgrade dependencies, call an LLM, connect to a production database, merge code, or deploy software.
