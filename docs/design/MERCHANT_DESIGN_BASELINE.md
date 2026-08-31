# Merchant App — Stitch Reference & Design Baseline

## 1. Overview
This document records the baseline design constraints and Stitch MCP project reference for the MyPetNew Merchant application (`apps/merchant-app`).

* **Stitch Project:** `MyPetNew Merchant — Existing Baseline`
* **Stitch Project ID:** `projects/16891330123471591482`
* **Design System Asset ID:** `156551a196e5496bac9443a9f8949d53`
* **Design System Screen:** `projects/16891330123471591482/screens/18165305735316726811`

---

## 2. Baseline Architecture & Design Constraints

| Dimension | Constraint & Invariant |
|---|---|
| **Form Factor** | Mobile-first application designed for handheld mobile devices and Android POS terminals. |
| **Pilot Platform** | Android-first pilot with barcode scanning (camera & physical hardware scanner adapter compatibility). |
| **Touch Targets** | All interactive touch targets (buttons, chips, list items, action triggers) must have a minimum dimension of 48px × 48px. |
| **Safe Areas** | Strict adherence to `react-native-safe-area-context` with `SafeAreaProvider` at root layout and `SafeAreaView` covering all top-level routes to respect display cutouts, notches, status bars, and home indicator gestures. |
| **Offline Persistence** | Prominent UI distinction between local SQLite cached data / outbox state and confirmed canonical backend state. |
| **State Consistency** | Explicit, standardized representations for `isLoading`, `isReady`, `error` (with retry action), `offline`, and empty states. |
| **Outlet Context** | Every operational surface clearly displays the active outlet identity and organization partition context. |
| **Safety Invariants** | No hidden or single-tap destructive actions; stock adjustments, damage write-offs, expiry reports, returns, and order rejections require explicit user confirmation. |
| **Canonical Distinction** | Local unacknowledged outbox commands are visually demarcated from server-acknowledged records. |

---

## 3. Screen Coverage Matrix

The Merchant application covers 11 functional route modules:

| Route Path | Screen Component | Function & Scope | Baseline Status |
|---|---|---|---|
| `app/index.tsx` | `MerchantEntryScreen` | Session restoration, signed-out landing, offline retry boundary, sign-out action | Certified |
| `app/login.tsx` | `MerchantLoginScreen` | Indian mobile (+91) OTP request, verification, rate-limit & error handling | Certified |
| `app/dashboard.tsx` | `MerchantDashboardScreen` | Operations KPI metrics, outlet selector, navigation hub | Certified |
| `app/inventory.tsx` | `MerchantInventoryScreen` | Stock ledger balance, movements, receiving, damage, expiry, shrinkage, returns, transfers, count sessions | Certified |
| `app/catalog.tsx` | `MerchantCatalogScreen` | Product listings, status filters, pricing, media synchronization | Certified |
| `app/barcode.tsx` | `MerchantBarcodeScreen` | Offline barcode resolution, new product draft creation, pending media queue, offline sync trigger | Certified |
| `app/orders.tsx` | `MerchantOrdersScreen` | Live order queue, state transitions (CONFIRMED, PREPARING, READY_FOR_PICKUP, COMPLETED, CANCELLED) | Certified |
| `app/appointments.tsx` | `MerchantAppointmentsScreen` | Booking inbox, auto-refresh, accept/reject decisions for grooming and veterinary requests | Certified |
| `app/notifications.tsx` | `MerchantNotificationsScreen` | Operational notification inbox with deep navigation routing | Certified |
| `app/staff.tsx` | `MerchantStaffScreen` | Staff authorization management, permission grants, revocation | Certified |
| `app/sync-status.tsx` | `MerchantSyncStatusScreen` | Sync engine status, partition summary, outbox attention list, manual retry, projection freshness | Certified |

---

## 4. Integration with MF2 (Visual Productionization)

MF1 certifies the runtime, router hygiene, dev-client, safe areas, and test isolation. During subsequent MF2 design execution:
1. Visual styling tokens from the Stitch design system will be applied without altering underlying route architecture.
2. Business logic, SQLite schema, sync protocols, and permissions contracts established in M0–M12 remain invariant.
