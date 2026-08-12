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
  error: '#BA1A1A',
  errorSoft: '#FFDAD6',
  darkSurface: '#111D2C',
  darkCard: '#1B293A',
  darkInk: '#EAF1FF',
  darkMuted: '#C3C6D7',
} as const;

export const spacing = { x1: 4, x2: 8, x3: 12, x4: 16, x6: 24, x8: 32, x12: 48 } as const;
export const radii = { compact: 8, card: 16, feature: 24, pill: 999 } as const;
export const touchTarget = 48;

export const fontFamilies = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extraBold: 'Inter_800ExtraBold',
} as const;

export const typography = {
  family: Platform.select({ web: 'Inter_400Regular, system-ui, sans-serif', default: fontFamilies.regular }),
  display: { fontFamily: fontFamilies.extraBold, fontSize: 32, lineHeight: 40, fontWeight: '800' as const, letterSpacing: -0.6 },
  headline: { fontFamily: fontFamilies.bold, fontSize: 24, lineHeight: 32, fontWeight: '700' as const },
  title: { fontFamily: fontFamilies.bold, fontSize: 20, lineHeight: 28, fontWeight: '700' as const },
  body: { fontFamily: fontFamilies.regular, fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontFamily: fontFamilies.semibold, fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontFamily: fontFamilies.medium, fontSize: 12, lineHeight: 16, fontWeight: '500' as const },
} as const;

export const shadows = {
  card: Platform.select({
    web: { boxShadow: '0 4px 16px rgba(11, 28, 48, 0.06)' },
    default: {
      shadowColor: '#0B1C30',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 2,
    },
  }),
  raised: Platform.select({
    web: { boxShadow: '0 8px 24px rgba(11, 28, 48, 0.10)' },
    default: {
      shadowColor: '#0B1C30',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 16,
      elevation: 4,
    },
  }),
} as const;

export type PetStoreScheme = 'light' | 'dark';

export function themeFor(scheme: PetStoreScheme) {
  return scheme === 'dark'
    ? {
        background: palette.darkSurface,
        surface: palette.darkCard,
        surfaceMuted: '#223247',
        text: palette.darkInk,
        textMuted: palette.darkMuted,
        primary: '#B4C5FF',
        primaryStrong: palette.royalBlueBright,
        primarySoft: '#263D70',
        accent: palette.amber,
        accentSoft: '#4A3515',
        success: '#4EDEA3',
        successSoft: '#123C31',
        border: '#405168',
        error: '#FFB4AB',
        errorSoft: '#5B2021',
      }
    : {
        background: palette.coolWhite,
        surface: palette.white,
        surfaceMuted: '#EFF4FF',
        text: palette.ink,
        textMuted: palette.inkMuted,
        primary: palette.royalBlue,
        primaryStrong: palette.royalBlueBright,
        primarySoft: palette.royalBlueSoft,
        accent: '#855300',
        accentSoft: palette.amberSoft,
        success: palette.emerald,
        successSoft: palette.emeraldSoft,
        border: palette.outline,
        error: palette.error,
        errorSoft: palette.errorSoft,
      };
}
