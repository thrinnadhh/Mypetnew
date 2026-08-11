# Security exceptions

Security exceptions are narrow, expiring, and do not certify Sprint 1. CI ignores only the listed advisory IDs; every other High or Critical production-dependency advisory fails the build.

| Advisory | Dependency path | Scope and mitigation | Owner | Review/expiry |
|---|---|---|---|---|
| GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 | Expo/React Native build tooling -> Metro -> `image-size` | Upstream reports no patched release. The Node library runs while bundling repository-controlled assets; it is not the mobile runtime decoder and receives no user-uploaded image. Do not add untrusted JXL/HEIF build inputs. | @thrinnadhh | Review on every Expo release; expires 2026-09-11 |
| GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 | Expo/React Native build tooling -> Metro -> `image-size` | Same transitive build-time boundary and mitigation. Remove the exception immediately when Expo/Metro selects a patched parser. | @thrinnadhh | Review on every Expo release; expires 2026-09-11 |

These exceptions are accepted only for source CI continuity. They remain explicit release risks, and an expiry without a reviewed renewal makes the dependency gate blocking.
