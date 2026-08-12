# MyPetNew Design System & Token Specification

## 1. Vision & Aesthetic Direction
MyPetNew is a modern, trusted pet care commerce and service platform. The UI design emphasizes visual clarity, warm approachable tones, high readability, and strict truthfulness to server-authoritative data.

## 2. Color Palette & Tokens
- **Primary**: HSL tailored teal/emerald (#0F766E / #0D9488) — representing trust, health, and vitality.
- **Primary Soft**: Light mint/teal tint (#F0FDFA) — card highlights, icon backgrounds.
- **Background**: Soft clean background (#F9FAFB / #FFFFFF).
- **Surface Element**: Card surface (#FFFFFF) with subtle border (#E5E7EB).
- **Text Primary**: Dark charcoal (#111827).
- **Text Secondary**: Neutral gray (#6B7280).
- **Text Muted**: Light gray (#9CA3AF).
- **Success**: Soft green (#16A34A).
- **Warning / Accent**: Amber (#D97706).
- **Error / Danger**: Warm red (#DC2626).

## 3. Typography & Spacing
- **Font Family**: System default (Inter / San Francisco / Roboto).
- **Headlines**: Semi-bold to Bold (16px to 24px).
- **Body**: Regular (14px to 16px).
- **Captions & Badges**: Medium (11px to 13px).
- **Spacing Scale**: 4px, 8px, 12px, 16px, 24px, 32px.
- **Card Radius**: 12px to 16px.

## 4. UI Principles for T2B2 Live Mode
- **Truthful Server Data**: Display only real, canonical server fields. Never render fake 0.0 ratings, 0 reviews, fake distances, or delivery ETAs in live mode.
- **Commerce Eligibility**: Clear, intuitive badges for "Store pickup available", "Out of stock", "Pickup unavailable", or "View only — online purchase unavailable".
- **Data Minimization**: Hide unsupported seller address, rating, or delivery ETA rows when backend fields are absent.
