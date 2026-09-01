# Merchant App — Stitch Reference & Design Baseline

## 1. Overview
This document records the baseline design constraints, Stitch MCP project reference, information architecture, and design system tokens for the MyPetNew Merchant application (`apps/merchant-app`).

* **Stitch Project:** `MyPetNew Merchant — Existing Baseline`
* **Stitch Project ID:** `projects/16891330123471591482`
* **Design System Asset ID:** `156551a196e5496bac9443a9f8949d53`
* **Design System Asset Name:** `Merchant Operations Core`
* **Stitch Screen Baseline:** `projects/16891330123471591482/screens/18165305735316726811`
* **Stitch Dashboard Production Screen:** `projects/16891330123471591482/screens/d650cc3b79f64efc9b904c9bbea1f9da`

---

## 2. Baseline Architecture & Design Constraints

| Dimension | Constraint & Invariant |
|---|---|
| **Form Factor** | Mobile-first application designed for handheld mobile devices and Android POS terminals. |
| **Pilot Platform** | Android-first pilot with barcode scanning (camera & physical hardware scanner adapter compatibility). |
| **Touch Targets** | All interactive touch targets (buttons, chips, list items, action triggers) must have a minimum dimension of **48px × 48px** (`spacing.touchTargetMin`). |
| **Safe Areas** | Strict adherence to `react-native-safe-area-context` with `SafeAreaProvider` at root layout and `SafeAreaView` covering all top-level routes to respect display cutouts, notches, status bars, and home indicator gestures. |
| **Offline Persistence** | Prominent UI distinction between local SQLite cached data / outbox state and confirmed canonical backend state. |
| **State Consistency** | Explicit, standardized representations for `isLoading`, `isReady`, `error` (with retry action), `offline`, and empty states. |
| **Outlet Context** | Every operational surface clearly displays the active outlet identity and organization partition context with quick outlet switching affordances. |
| **Safety Invariants** | No hidden or single-tap destructive actions; stock adjustments, damage write-offs, expiry reports, returns, and order rejections require explicit user confirmation. |
| **Canonical Distinction** | Local unacknowledged outbox commands are visually demarcated from server-acknowledged records. |

---

## 3. MF2 Information Architecture & Primary Navigation

The application uses an Android-friendly 5-destination bottom navigation bar combined with an operational "More" sheet to keep primary destinations accessible within 1 tap:

### Primary Bottom Navigation
1. **Home (`/dashboard`)**: Operations KPI summary, outlet switcher, sync banner, quick actions.
2. **Orders (`/orders`)**: Live order work queue, preparation, fulfilment state transitions.
3. **Inventory (`/inventory`)**: Stock ledger, balance, count sessions, stock movements.
4. **Catalog (`/catalog`)**: Product listings, active status filters, pricing, media synchronization.
5. **More (Modal Sheet)**:
   * **Barcode Scanner (`/barcode`)**: Offline barcode resolution & product draft onboarding.
   * **Booking Requests (`/appointments`)**: Grooming & veterinary appointment management.
   * **Notifications (`/notifications`)**: Operational alerts inbox with badge indicators.
   * **Manage Staff (`/staff`)**: Role assignments and outlet permissions.
   * **Sync & Conflicts (`/sync-status`)**: Device outbox details and projection freshness.
   * **Sign Out**: Session logout action.

---

## 4. Semantic Design Tokens (`src/design/tokens/`)

### Color Palette
* **Action Primary**: `#006194` (Brand Blue / Primary CTAs), `onPrimary: #ffffff`, `primaryContainer: #007bb9`
* **Surfaces & Canvas**: Canvas `#f8fafc` (`surfaceDim`), White `#ffffff` (`surface`), `surfaceContainer: #e2e8f0`
* **Slate Neutrals**: `#0f172a` (slate900), `#334155` (slate700), `#64748b` (slate500), `#cbd5e1` (border slate300)
* **Feedback States**:
  * Success: `#006b2c` / `#16a34a` (green), container: `#dcfce7`
  * Warning: `#b45309` (amber), container: `#fef3c7`
  * Error: `#dc2626` (red), container: `#fee2e2`
* **Connectivity & Sync**:
  * Online: `#15803d` / `#f0fdf4`
  * Syncing: `#0284c7` / `#eff6ff`
  * Pending: `#d97706` / `#fff7ed`
  * Sync Failed: `#dc2626` / `#fef2f2`
  * Offline: `#64748b` / `#f1f5f9`

### Spacing & Metrics
* `touchTargetMin: 48px`
* `marginEdge: 16px`
* `gutter: 12px`
* `headerHeight: 56px`
* `bottomNavHeight: 64px`

### Typography (Inter Font System)
* `headlineLg`: 28px / 36px (800 weight)
* `headlineLgMobile`: 24px / 32px (800 weight)
* `headlineMd`: 20px / 28px (700 weight)
* `labelLg`: 16px / 24px (700 weight)
* `labelMd`: 14px / 20px (600 weight)
* `labelSm`: 12px / 16px (600 weight)
* `bodyLg`: 16px / 24px (400 weight)
* `bodyMd`: 14px / 20px (400 weight)
* `metricValue`: 32px / 38px (800 weight)
* `codeSm`: 12px / 16px (500 weight monospace)

---

## 5. Reusable UI Primitives (`src/design/components/`)

* **`MerchantScreen`**: Standard container managing SafeAreaInsets, persistent header, scrollview/fixed layouts, and offline banners.
* **`MerchantHeader`**: Context header rendering active outlet name, outlet switcher modal trigger, sync indicator, notification badge, and profile affordance.
* **`BottomNavigation`**: 5-destination bottom navigation bar with active states, badges, and "More" operational sheet.
* **`StatusBadge`**: Semantic status pill with WCAG AA contrast colors and accessibility text roles.
* **`SyncIndicator`**: Connectivity state indicator (Online, Syncing, Pending, Failed, Offline) with pending count badges.
* **`OfflineBanner`**: High-visibility banner when disconnected or when unsent outbox commands exist.
* **`MetricCard`**: High-density KPI card with 32px metric display, descriptive details, and navigation trigger.
* **`ActionCard`**: Minimum 48dp action card for high-frequency workflows.
* **`SectionHeader`**: Clean section title with optional subtitle and action trigger.
* **`EmptyState`**, **`ErrorState`**, **`LoadingState`**: Accessible state containers with `accessibilityRole` and `accessibilityLiveRegion` support.
* **`PrimaryButton`**, **`SecondaryButton`**, **`IconButton`**: Touch-accessible buttons guaranteeing >= 48dp touch targets.
* **`OutletPickerModal`**: Modal dialog for fast switching between "All Outlets" and specific outlet partitions.

---

## 6. Accessibility Certification

1. **Touch Target Dimensions**: Verified all interactive elements (buttons, nav items, chips, metric cards) meet or exceed 48px × 48px.
2. **Text & Visual Contrast**: High-contrast ratios meeting WCAG AA standards (minimum 4.5:1 for body text, 3:1 for large headlines and components).
3. **Semantic Roles & States**:
   * All buttons specify `accessibilityRole="button"` and `accessibilityState={{ disabled, busy }}`.
   * Tab bars specify `accessibilityRole="tablist"` and tabs specify `accessibilityRole="tab"`, `accessibilityState={{ selected }}`.
   * Radio options in outlet selector specify `accessibilityRole="radio"`, `accessibilityState={{ selected }}`.
   * Status banners and error messages specify `accessibilityRole="alert"` and `accessibilityLiveRegion="polite"` / `"assertive"`.
   * Loading states specify `accessibilityRole="progressbar"`.
4. **No Color-Only Communication**: Status badges and sync states include explicit textual descriptions and count badges alongside colored indicator dots.

---

## 7. Deferred Work (MF3+)

* **MF3 — Catalog & Product Presentation Redesign**: Detailed product listing cards, category filtering, pricing edits, and media queue visualization.
* **MF4 — Inventory Ledger & Count Operations Redesign**: Advanced multi-session stock counting, scanning viewfinder integration, and movement history views.
* **MF5 — Order Fulfilment & Queue Flow Redesign**: Live order timeline, kitchen/packing tickets, and courier dispatch handoff.
* **MF6 — Appointments & Service Booking Redesign**: Calendar slot grid, customer pet history, groomer/vet assignment.
* **MF7 — Barcode Scanner & POS Hardware Integration**: Hardware laser scanner integration, viewfinder haptics, and fast barcode continuous scanning.
