# Merchant App — Stitch Reference & Design Baseline

## 1. Overview
This document records the baseline design constraints, Stitch MCP project reference, information architecture, and design system tokens for the MyPetNew Merchant application (`apps/merchant-app`).

* **Stitch Project:** `MyPetNew Merchant — Existing Baseline`
* **Stitch Project ID:** `projects/16891330123471591482`
* **Design System Asset ID:** `156551a196e5496bac9443a9f8949d53`
* **Design System Asset Name:** `Merchant Operations Core`
* **Stitch Screen Baseline:** `projects/16891330123471591482/screens/18165305735316726811`
* **Stitch Dashboard Production Screen:** `projects/16891330123471591482/screens/d650cc3b79f64efc9b904c9bbea1f9da`
* **Stitch Orders Production Screen:** `projects/16891330123471591482/screens/9ab5d6b4be3c4bed8ec0725818cfa63c`
* **Stitch Inventory Production Screen:** `projects/16891330123471591482/screens/3987b29793444dd8980f3a0347fd83dd`
* **Stitch Stock Adjustments Screen:** `projects/16891330123471591482/screens/e2e8886240644155a425e576709788ca`
* **Stitch Movement Ledger Screen:** `projects/16891330123471591482/screens/02adf9ae32b64384bd0061f2ec9a28e5`
* **Stitch Catalog Production Screen:** `projects/16891330123471591482/screens/b09a4b4bc1d74a378eacf46fdb381503`
* **Stitch Product Editor Screen:** `projects/16891330123471591482/screens/0d05c260fe7f404d8eaed893a95f2d50`
* **Stitch Appointments List Screen (MF4):** `projects/16891330123471591482/screens/1a321f6399a64087ba1dc07c76311868`
* **Stitch Appointment Detail - Booked (MF4):** `projects/16891330123471591482/screens/b12705b77e5e455694ea71aa4694589d`
* **Stitch Appointment Detail - Confirmed (MF4):** `projects/16891330123471591482/screens/0cf0d76dd7c143f193312e5e6b7708bf`
* **Stitch Appointment Detail - In Service (MF4):** `projects/16891330123471591482/screens/1776c4d464974a48a32293b63e079382`

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
| **Safety Invariants** | No hidden or single-tap destructive actions; stock adjustments, damage write-offs, expiry reports, returns, and order/appointment rejections require explicit user confirmation with validated reasons. |
| **Canonical Distinction** | Local unacknowledged outbox commands are visually demarcated from server-acknowledged records. |
| **Payment Authority** | Client never assumes payment authority; payment state displays canonical server/webhook state. |

---

## 3. Information Architecture & Primary Navigation

The application uses an Android-friendly 5-destination bottom navigation bar combined with an operational "More" sheet to keep primary destinations accessible within 1 tap:

### Primary Bottom Navigation
1. **Home (`/dashboard`)**: Operations KPI summary, outlet switcher, sync banner, quick actions.
2. **Orders (`/orders`)**: Live order work queue, preparation, fulfilment state transitions, and cancellation reason modals.
3. **Inventory (`/inventory`)**: Stock ledger, balance, 8 movement operation workflows, count sessions, stock timeline.
4. **Catalog (`/catalog`)**: Product listings, active/inactive status filters, pricing & margin calculation, photo management.
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
* `headlineSm`: 18px / 24px (700 weight)
* `labelLg`: 16px / 24px (700 weight)
* `labelMd`: 14px / 20px (600 weight)
* `labelSm`: 12px / 16px (600 weight)
* `bodyLg`: 16px / 24px (400 weight)
* `bodyMd`: 14px / 20px (400 weight)
* `bodySm`: 13px / 18px (400 weight)
* `metricValue`: 32px / 38px (800 weight)
* `codeSm`: 12px / 16px (500 weight monospace)

---

## 5. Reusable UI Primitives (`src/design/components/`)

### Foundation Primitives
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

### Operational Primitives (MF3 & MF4)
* **`FilterBar`**: Horizontal chip filter bar with badge counts and scroll support.
* **`SearchInput`**: Accessible search field with clear action and optional barcode scanner trigger.
* **`ConfirmationModal`**: Destructive action confirmation modal with validated reason text entry.
* **`OrderCard`**: Production order card with elapsed time, amount, fulfillment mode, payment status, and action buttons.
* **`OrderDetailModal`**: Modal sheet displaying complete order breakdown, items, and transition buttons.
* **`InventoryCard`**: 3-col inventory stock metric card (On Hand, Reserved, Available) with stock badges, sync badges, and operations bar.
* **`StockAdjustmentModal`**: Comprehensive modal supporting all 8 stock operation modes (Manual, Receiving, Damage, Expiry, Shrinkage, Return, Transfer, Count).
* **`MovementLedgerModal`**: Historical stock movement timeline with +/- quantity delta badges and source references.
* **`CatalogProductCard`**: Product card with image thumbnail, category/medicine chips, price comparison, image quota, active toggle, and edit action.
* **`ProductEditorModal`**: Full product creation and edit modal sheet with validation, live margin calculation, and barcode scanner shortcut.
* **`AppointmentCard` (MF4)**: Operational appointment card with grooming/vet category pills, scheduled time range, duration, customer notes preview, payment status badge, price, and state-specific action buttons.
* **`AppointmentDetailModal` (MF4)**: Full appointment lifecycle detail modal sheet with service details, pet context, customer special instructions, payment breakdown, and server-authorized transition buttons.

---

## 6. MF4 Appointments & Service Operations Baseline

### State Machine & Merchant Transitions
The Merchant application strictly enforces backend-defined appointment lifecycle rules:
* `BOOKED` -> `CONFIRMED` ("Accept Booking")
* `BOOKED` -> `REJECTED` ("Reject Booking", requires reason)
* `CONFIRMED` -> `CHECKED_IN` ("Mark Checked In")
* `CHECKED_IN` -> `IN_SERVICE` ("Start Service")
* `IN_SERVICE` -> `COMPLETED` ("Complete Service", explicit confirmation)
* `BOOKED` / `CONFIRMED` -> `NO_SHOW` ("Mark No-Show")
* `BOOKED` / `CONFIRMED` -> `CANCELLED` ("Cancel Appointment", requires reason)

### Offline & Stale-State Behavior
* **Offline Read:** MF4R does not claim a persistent appointment cache that does not exist. The screen may retain the last successfully loaded data for the same outlet during the current process session; switching to an outlet that cannot be loaded while offline clears the prior outlet data and states that no appointment cache is available.
* **Offline Transitions:** Mutation actions are disabled when offline to preserve authoritative backend state rules.
* **Stale Reconciliation:** When an appointment status transition is rejected due to server state change (e.g. action taken on another device), the UI alerts the merchant, re-fetches canonical state from the server, and updates the local workload.

### MF4R Runtime & Contract Repairs
* **Explicit Outlet Scope:** `/api/v1/merchant/appointments` accepts an authorized `outletId`; the backend enforces the authenticated merchant's outlet scope before querying. Omitting `outletId` preserves the shared All Outlets consolidated view across authorized outlets. The UI clears the prior scope immediately during a switch to prevent cross-outlet stale presentation.
* **Operational Query Semantics:** Merchant workload queries exclude transient `HOLD` / `HOLD_EXPIRED` payment-reservation records. Active work is ordered by scheduled start time; terminal history follows active work in reverse scheduled order.
* **Pagination & Virtualization:** The appointment work queue uses a `FlatList` and loads canonical pages of 50 records as the merchant scrolls instead of silently truncating after the first 100.
* **Deep-Link Resolution:** A notification/deep-link appointment absent from page zero is fetched canonically by ID, checked against merchant outlet scope, and opened in its owning outlet context.
* **Destructive Reasons:** `REJECTED` and `CANCELLED` require a <=240-character operator reason in both client and backend validation. The reason is persisted to appointment history and passed into terminal payment/refund projection.
* **Complete Action Reachability:** `NO_SHOW`, `CANCELLED`, and `REJECTED` remain distinct reachable actions rather than collapsing to the first destructive action.
* **Runtime Effect Safety:** Appointment initialization no longer depends on state that it mutates, preventing repeated context/workload fetch loops. The inherited MF3 Orders loader was repaired with the same explicit-context pattern.
* **Navigation Truthfulness:** Appointments mark the bottom navigation's `More` destination active rather than visually selecting `Orders`.
* **Mounted Regression Tests:** Appointment screen tests mount the real React hook lifecycle with `react-test-renderer`; they cover initialization count, outlet switching, offline isolation, pagination, deep links, reason propagation, and no-show reachability.

---

## 7. Accessibility Certification

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

## 8. Deferred Work (MF5+)

* **MF5 — Barcode Scanner & POS Hardware Integration**: Hardware laser scanner integration, viewfinder haptics, and fast barcode continuous scanning.
* **MF6 — Staff Access & Permissions Admin**: Multi-role assignment matrix, granular outlet permission management.
* **MF7 — Store Performance Analytics & Reporting**: Sales revenue charts, bestsellers matrix, and shrinkage reconciliation reporting.
