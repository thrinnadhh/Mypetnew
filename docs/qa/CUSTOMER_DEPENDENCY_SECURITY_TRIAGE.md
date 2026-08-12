# Customer Application Dependency Security Triage

Date: **2026-08-12**  
Target App: `apps/customer-app` (Expo SDK 56 / React Native 0.85.3)  
Auditor: **Trial Engineering (T4)**

---

## 1. Executive Summary

An audit of `apps/customer-app` (`npm audit`) identifies **14 high-severity security advisories**, all originating from a single transitive dependency tree under the Metro bundler asset processing pipeline (`image-size`).

No direct customer app runtime dependency or production mobile bundle code is affected. All advisories are limited to local development and build-time bundling. Applying `npm audit fix --force` would attempt to force-downgrade React Native / Expo to Expo SDK 53 (`react-native` 0.72.17), which breaks Expo SDK 56 compatibility. Therefore, these advisories are classified as accepted build-tool development exceptions per Decision `D-002` and `S1-01`.

---

## 2. Dependency Advisory Inventory

| Field | Value |
|---|---|
| **Package** | `image-size` |
| **Severity** | High |
| **Advisories** | GHSA-w3rx-r6r6-pgpr (ICNS infinite loop DoS), GHSA-5p2g-fcmc-qvqq (JXL/HEIF infinite loop DoS) |
| **Dependency Path** | `apps/customer-app` → `expo` → `@expo/cli` → `@expo/metro` → `metro` → `metro-config` / `metro-transform-worker` → `image-size` |
| **Classification** | **Development / Build-only** (Metro bundler asset dimension parsing during local development and Expo export) |
| **Runtime Reachability** | **NOT REACHABLE AT RUNTIME**. `image-size` is a Node.js CLI build tool component used by Metro bundler to calculate image dimensions during JS bundle creation. It is never included in the compiled Expo React Native JavaScript application bundle shipped to iOS or Android physical devices. |
| **Affected Behavior** | If a developer attempts to bundle a maliciously crafted `.icns`, `.jxl`, or `.heif` asset file during local Metro compilation, the Metro process could enter an infinite CPU loop. Standard application `.png`, `.jpeg`, and `.webp` assets are completely unaffected. |
| **Fix Version** | Downstream Metro / Expo CLI toolchain patch in future Expo SDK release. |
| **Action** | **Accepted Temporary Exception**. Do not force-downgrade Expo SDK 56 or React Native 0.85.3. Retain current Expo SDK 56 dependencies. |
| **Remaining Risk** | Minimal. Restricted strictly to developer workstation build time if an untrusted `.icns` or `.jxl` asset is added to the source repository. Zero risk to production mobile app runtime on user devices. |

---

## 3. Expo SDK 56 Compatibility Decision

- **Expo Version**: `~56.0.19`
- **React Native Version**: `0.85.3`
- **React Version**: `19.2.3`

Running `npm audit fix --force` breaks the Expo SDK 56 toolchain by attempting to downgrade `react-native` to `0.72.17` and `expo` to `53.0.27`. This exception is documented and tracked for upstream resolution in the next Expo SDK patch release.
