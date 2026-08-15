import { Platform } from 'react-native';

import { fontFamilies, palette, radii, shadows, spacing, themeFor } from '@/design/tokens';

const light = themeFor('light');
const dark = themeFor('dark');

function legacyTheme(theme: ReturnType<typeof themeFor>) {
  return {
    text: theme.text,
    background: theme.background,
    backgroundElement: theme.surface,
    backgroundSelected: theme.primarySoft,
    textSecondary: theme.textMuted,
    primary: theme.primary,
    primarySoft: theme.primarySoft,
    cta: theme.primaryStrong,
    ctaSoft: theme.primarySoft,
    success: theme.success,
    warning: palette.amber,
    danger: theme.error,
    border: theme.border,
    muted: theme.surfaceMuted,
    accent: theme.accent,
    accentSoft: theme.accentSoft,
    heroGradientStart: theme.background,
    heroGradientEnd: theme.primarySoft,
    error: theme.error,
    errorSoft: theme.errorSoft,
    successSoft: theme.successSoft,
  } as const;
}

export const Colors = {
  light: legacyTheme(light),
  dark: legacyTheme(dark),
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: { sans: fontFamilies.regular, serif: 'ui-serif', rounded: fontFamilies.regular, mono: 'ui-monospace' },
  default: { sans: fontFamilies.regular, serif: 'serif', rounded: fontFamilies.regular, mono: 'monospace' },
  web: { sans: `${fontFamilies.regular}, system-ui, sans-serif`, serif: 'ui-serif', rounded: `${fontFamilies.regular}, system-ui, sans-serif`, mono: 'ui-monospace' },
}) ?? { sans: fontFamilies.regular, serif: 'serif', rounded: fontFamilies.regular, mono: 'monospace' };

export const Spacing = {
  half: 2,
  one: spacing.x1,
  two: spacing.x2,
  three: spacing.x4,
  four: spacing.x6,
  five: spacing.x8,
  six: spacing.x12,
} as const;

export const Radius = {
  sm: radii.compact,
  md: radii.compact,
  lg: radii.card,
  xl: radii.feature,
} as const;

export const Shadows = {
  card: shadows.card ?? {},
  pressed: Platform.select({
    web: { boxShadow: '0 2px 8px rgba(11, 28, 48, 0.08)' },
    default: { shadowColor: palette.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 1 },
  }) ?? {},
} as const;

export const BottomTabInset = Platform.select({ ios: 82, android: 74, web: 72 }) ?? 72;
export const MaxContentWidth = 800;
