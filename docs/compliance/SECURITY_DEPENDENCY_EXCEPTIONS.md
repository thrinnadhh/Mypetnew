# Security and dependency exceptions

Status: controlled exception register, 2026-08-15. An exception never means a dependency is safe or the release is compliant. High/Critical production dependency findings not listed here fail CI.

| ID | Scope | Why removal is not currently available | Compensating controls | Owner | Review / expiry | Release treatment |
|---|---|---|---|---|---|---|
| GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 | Expo/React Native build tooling → Metro → `image-size` | Upstream path has no selected patched release in current Expo SDK line | Repository-controlled build assets only; prohibit untrusted JXL/HEIF build input; production runtime does not call this parser; dependency audit remains enabled | @thrinnadhh | Review every Expo release; hard expiry 2026-09-11 | Source CI exception only; release owner must confirm no untrusted build input |
| GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 | Same build-time dependency path | Same | Same | @thrinnadhh | Review every Expo release; hard expiry 2026-09-11 | Same |
| GHSA-w5hq-g745-h8pq | Expo CLI/config-plugin → `xcode` → `uuid@7.0.3` | Patched `uuid>=11.1.1` is outside the transitive major range; forcing it risks build configuration compatibility | Build-time path; no caller supplies a `buf` to UUID v3/v5/v6; no user input reaches native config; Moderate finding remains visible in live audit | @thrinnadhh | Review every Expo release; expires 2026-09-11 | Tracked Moderate exception; not hidden from audit and not a mobile-runtime permission |
| SDK 57 current-patch release-age hold | Expo 57.0.13 patch family published 2026-08-14; repository remains at 57.0.12 family and declares Expo validation exclusions only for the pinned Expo packages | The active minimum-release-age policy rejected 17 packages on 2026-08-15; bypassing it would weaken the supply-chain gate | No SDK/RN boundary change; React/TypeScript and required Router peers aligned; native packages deduplicated; React Native worklets/reanimated pinned to the SDK 57-compatible 0.10.1/4.5.3 pair; all three Doctor runs pass 20/20, with version checks explicitly skipped only for listed Expo pins | @thrinnadhh | Remove/retest no earlier than 2026-08-17; hard expiry 2026-08-22 | Temporary version-validation exception, not approval to ship without physical tests |

Canonical CI-readable context also exists in `docs/qa/SECURITY_EXCEPTIONS.md`. The two registers must change together. Expiry, wider runtime reach, user-controlled input, a patched supported release or an increase in severity immediately invalidates the exception.

## Exception process

Every new exception requires advisory/source evidence, exact dependency path and environment, exploitability analysis, compensating test/control, accountable owner, issue link, shortest practical expiry and Security approval. Secrets, raw payment credentials, disabled authentication/authorization, public data stores, missing breach reporting, or bypassed High/Critical findings in a runtime path are not acceptable as routine exceptions.

Current SBOM/provenance and signed artifact evidence are absent. CI machine-enforces the two High advisory expiries through the dependency-audit script; the shorter Expo release-age hold still needs automated expiry enforcement.
