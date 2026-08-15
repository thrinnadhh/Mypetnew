# Security exceptions

Security exceptions are narrow, expiring, and do not certify Sprint 1. CI ignores only the two High `image-size` advisory IDs; every other High or Critical production-dependency advisory fails the build. Lower findings and version holds remain visible below.

| Advisory | Dependency path | Scope and mitigation | Owner | Review/expiry |
|---|---|---|---|---|
| GHSA-w3rx-r6r6-pgpr / CVE-2025-71330 | Expo/React Native build tooling -> Metro -> `image-size` | Upstream reports no patched release. The Node library runs while bundling repository-controlled assets; it is not the mobile runtime decoder and receives no user-uploaded image. Do not add untrusted JXL/HEIF build inputs. | @thrinnadhh | Review on every Expo release; expires 2026-09-11 |
| GHSA-5p2g-fcmc-qvqq / CVE-2025-71329 | Expo/React Native build tooling -> Metro -> `image-size` | Same transitive build-time boundary and mitigation. Remove the exception immediately when Expo/Metro selects a patched parser. | @thrinnadhh | Review on every Expo release; expires 2026-09-11 |
| GHSA-w5hq-g745-h8pq | Expo build/config tooling -> `xcode` -> `uuid@7.0.3` | Moderate; affected buffer-supplying UUID APIs are not used with untrusted input in this build path. Keep visible in audit; do not force an incompatible major. | @thrinnadhh | Review on every Expo release; expires 2026-09-11 |
| SDK 57 current patch hold | Expo 57.0.13 family published 2026-08-14 | Minimum-release-age policy rejected 17 new packages on 2026-08-15. Only the affected Expo packages are listed in each app's `expo.install.exclude`; React/TypeScript, Router peers and native deduplication are aligned, and Doctor passes 20/20 with the exclusion disclosed. | @thrinnadhh | Recheck no earlier than 2026-08-17; expires 2026-08-22 |

These exceptions are accepted only for source CI continuity. They remain explicit release risks, and an expiry without a reviewed renewal makes the dependency gate blocking.
