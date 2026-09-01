export const spacing = {
  none: 0,
  base: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,

  // Operational Layout Constants
  touchTargetMin: 48,
  marginEdge: 16,
  gutter: 12,
  cardPadding: 16,
  headerHeight: 56,
  bottomNavHeight: 64,
} as const;

export type SpacingToken = keyof typeof spacing;
