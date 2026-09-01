import { ViewStyle } from 'react-native';
import { colors } from './colors';

export const elevation = {
  level0: {
    backgroundColor: colors.surfaceDim,
  } as ViewStyle,

  level1: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  } as ViewStyle,

  level2: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  } as ViewStyle,

  level3: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
  } as ViewStyle,

  // Special treatment for local SQLite unconfirmed outbox data
  transient: {
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.slate400,
    borderStyle: 'dashed',
  } as ViewStyle,
} as const;

export type ElevationToken = keyof typeof elevation;
