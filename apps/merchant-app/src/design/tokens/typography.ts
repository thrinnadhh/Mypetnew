import { TextStyle } from 'react-native';
import { colors } from './colors';

export const typography = {
  headlineLg: {
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800' as TextStyle['fontWeight'],
    letterSpacing: -0.5,
    color: colors.onSurface,
  },
  headlineLgMobile: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '800' as TextStyle['fontWeight'],
    letterSpacing: -0.3,
    color: colors.onSurface,
  },
  headlineMd: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700' as TextStyle['fontWeight'],
    color: colors.onSurface,
  },
  headlineSm: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700' as TextStyle['fontWeight'],
    color: colors.onSurface,
  },
  labelLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '700' as TextStyle['fontWeight'],
    color: colors.onSurface,
  },
  labelMd: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600' as TextStyle['fontWeight'],
    color: colors.onSurface,
  },
  labelSm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as TextStyle['fontWeight'],
    color: colors.slate600,
  },
  bodyLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as TextStyle['fontWeight'],
    color: colors.slate700,
  },
  bodyMd: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as TextStyle['fontWeight'],
    color: colors.slate700,
  },
  bodySm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400' as TextStyle['fontWeight'],
    color: colors.slate500,
  },
  codeSm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as TextStyle['fontWeight'],
    fontFamily: 'monospace',
    color: colors.slate800,
  },
  metricValue: {
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '800' as TextStyle['fontWeight'],
    color: colors.primary,
  },
} as const;

export type TypographyToken = keyof typeof typography;
