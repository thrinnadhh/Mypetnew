---
name: MyPet Platform Design System
colors:
  primary: "#004AC6"
  primary-bright: "#2563EB"
  primary-soft: "#DBE1FF"
  accent: "#FEA619"
  accent-soft: "#FFDDB8"
  success: "#10B981"
  success-soft: "#D1FAE5"
  error: "#BA1A1A"
  error-soft: "#FFDAD6"
  surface: "#FFFFFF"
  surface-muted: "#EFF4FF"
  background: "#F8F9FF"
  ink: "#0B1C30"
  ink-muted: "#434655"
  outline: "#C3C6D7"
  outline-soft: "#E2E8F0"
typography:
  display:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: 800
    lineHeight: 1.2
  headline:
    fontFamily: Inter
    fontSize: 22px
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
rounded:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    height: 48px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: 48px
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 16px
---

# MyPet Platform Design System

## Overview
A high-trust, high-efficiency operational and consumer design system for pet healthcare, grooming, and retail commerce across Customer and Merchant applications.

## Colors
- **Royal Blue (`#004AC6`):** Primary brand authority, core action buttons, and active tabs.
- **Warm Amber (`#FEA619`):** 10-Star loyalty milestones, pending decision alerts, and SLA warnings.
- **Emerald Green (`#10B981`):** Verified states, in-stock inventory, paid online confirmations.
- **Cool White (`#F8F9FF`):** Clean, non-glare foundation background.
- **Dark Ink (`#0B1C30`):** High-contrast text and crisp data representation.

## Typography
Inter typography scale optimized for dense mobile displays and fast operational scanning in store environments.

## Layout
4px/8px baseline grid with 16px standard mobile margins and 48px minimum touch targets.

## Elevation & Depth
Flat corporate modernism with subtle 1px borders (`#E2E8F0`) and soft ambient shadows.

## Shapes
Consistent 8px card radius with fully rounded pills for status indicators.

## Components
- **Primary Buttons:** Solid Royal Blue with white bold text (48px height).
- **Status Chips:** High-contrast pill badges with 10% tinted background and 100% solid text.
- **Data Cards:** 16px rounded white surfaces with 1px border.

## Do's and Don'ts
- Do enforce 48px minimum touch targets for all operational actions.
- Do use Emerald Green for verified payments and Amber for pending decision states.
- Don't use generic purple or unbranded gradients.
