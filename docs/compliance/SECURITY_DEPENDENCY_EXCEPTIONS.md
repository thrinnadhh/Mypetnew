# Security and dependency exceptions

Status: controlled exception register, 2026-08-16. An exception never means a dependency is safe or the release is compliant. High/Critical production dependency findings not listed here fail CI.

| ID | Scope | Why removal is not currently available | Compensating controls | Owner | Review / expiry | Release treatment |
|---|---|---|---|---|---|---|
| GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 | Expo/React Native build tooling → Metro → `image-size` | Upstream path has no selected patched release in current Expo SDK line | Repository-controlled build assets only; prohibit untrusted JXL/HEIF build input; production runtime does not call this parser; dependency audit remains enabled | @thrinnadhh | Review every Expo release; hard expiry 2026-09-11 | Source CI exception only; release owner must confirm no untrusted build input |
| GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 | Same build-time dependency path | Same | Same | @thrinnadhh | Review every Expo release; hard expiry 2026-09-11 | Same |
| GHSA-6gmq-8vp8-gcm6 | Expo build tooling → `@expo/plist` / `plist` → `@xmldom/xmldom` | Upstream `@expo/plist` has not yet bumped xmldom dependency | Build-time plist parser only; no user-controlled XML at runtime; absent from web/mobile production bundles | @thrinnadhh | Review every Expo release; hard expiry 2026-11-30 | Source CI exception only; build tooling only |

Expiry, wider runtime reach, user-controlled input, a patched supported release or an increase in severity immediately invalidates an exception. Customer-specific dependency evidence is tracked in `docs/qa/CUSTOMER_DEPENDENCY_SECURITY_TRIAGE.md`.

## Exception process

Every new exception requires advisory/source evidence, exact dependency path and environment, exploitability analysis, compensating test/control, accountable owner, issue link, shortest practical expiry and Security approval. Secrets, raw payment credentials, disabled authentication/authorization, public data stores, missing breach reporting, or bypassed High/Critical findings in a runtime path are not acceptable as routine exceptions.

Current SBOM/provenance and signed artifact evidence are absent. The Customer workflow now allowlists only these two advisory URLs, fails closed on every other High/Critical production-dependency finding, and machine-enforces the 2026-09-11 expiry. The existing Merchant exception remains subject to its own workflow controls and the same release-owner review requirement.
