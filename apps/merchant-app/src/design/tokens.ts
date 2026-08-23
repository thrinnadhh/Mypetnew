import { Platform } from 'react-native';

export const palette = {
  royalBlue: '#004AC6',
  royalBlueBright: '#2563EB',
  royalBlueSoft: '#DBE1FF',
  amber: '#FEA619',
  amberSoft: '#FFDDB8',
  emerald: '#10B981',
  emeraldSoft: '#D1FAE5',
  coolWhite: '#F8F9FF',
  white: '#FFFFFF',
  ink: '#0B1C30',
  inkMuted: '#434655',
  outline: '#C3C6D7',
  outlineSoft: '#E2E8F0',
  error: '#BA1A1A',
  errorSoft: '#FFDAD6',
  darkSurface: '#111D2C',
  darkCard: '#1B293A',
} as const;

export const spacing = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
  x8: 32,
  x12: 48,
} as const;

export const radii = {
  xs: 4,
  compact: 8,
  card: 16,
  feature: 24,
  pill: 999,
} as const;

export const touchTarget = 48;

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
} as const;

export const typography = {
  family: Platform.select({ web: 'Inter, system-ui, -apple-system, sans-serif', default: fontFamilies.regular }),
  display: { fontSize: 28, lineHeight: 36, fontWeight: '800' as const, letterSpacing: -0.5 },
  headline: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodySmall: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const, letterSpacing: 0.2 },
} as const;

export const theme = {
  background: palette.coolWhite,
  surface: palette.white,
  surfaceElevated: '#FFFFFF',
  surfaceMuted: '#EFF4FF',
  text: palette.ink,
  textMuted: palette.inkMuted,
  primary: palette.royalBlue,
  primaryStrong: palette.royalBlueBright,
  primarySoft: palette.royalBlueSoft,
  accent: palette.amber,
  accentSoft: palette.amberSoft,
  success: palette.emerald,
  successSoft: palette.emeraldSoft,
  border: palette.outlineSoft,
  error: palette.error,
  errorSoft: palette.errorSoft,
};
