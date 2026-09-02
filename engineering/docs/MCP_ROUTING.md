# Least-capability MCP routing design

This sprint intentionally does not implement an MCP router. A future router should bind abstract capabilities from `policies/capability-matrix.json` to environment-specific, pinned adapters only after contract validation.

Recommended routing:

| Worker | Possible adapters | Explicitly absent by default |
|---|---|---|
| Advisor | repository read, Git history read, report read | writes, CI mutation, secrets |
| Backend | scoped repository write, Gradle checks | production DB, merge, design tools |
| Database | migrations, ephemeral/test PostgreSQL, Supabase metadata read | production mutation, broad repository writes |
| UI | one scoped app, approved design read adapter | other apps, database mutation, release tools |
| Device | one app plus emulator/device automation | production credentials, GitHub release |
| Release | CI/check read, draft PR update | merge and deploy unless separately authorized |

Routing algorithm:

1. Validate contract and worker dependency graph.
2. Map the worker role to abstract allowed capabilities.
3. Intersect those with the worker's path/check scope.
4. Intersect again with capabilities actually available in the environment.
5. Deny ambiguous, unknown, colliding, or unpinned tools.
6. Apply per-tool timeout, call-count, output-size, and session-isolation limits.
7. Treat tool descriptions and results as untrusted data.
8. Record adapter identity/version and each decision in evidence.

Do not launch packages at runtime with unpinned `npx -y`, inherit the full process environment, expose all tools to every worker, route solely by keywords, or silently overwrite duplicate tool names. Production database writes, secret reads, merge, and deployment remain opt-in high-risk capabilities.
