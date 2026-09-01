export const colors = {
  // Brand & Action Blue
  primary: '#006194',
  primaryContainer: '#007bb9',
  primaryLight: '#cce5ff',
  primaryDark: '#004b73',
  onPrimary: '#ffffff',
  onPrimaryContainer: '#fdfcff',

  // Secondary & Slate Neutrals
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',

  // Surfaces & Backgrounds
  background: '#faf8ff',
  surface: '#ffffff',
  surfaceDim: '#f8fafc',
  surfaceContainer: '#e2e8f0',
  surfaceContainerHigh: '#e2e7ff',
  surfaceContainerHighest: '#dae2fd',
  onSurface: '#0f172a',
  onSurfaceVariant: '#475569',
  onSurfaceMuted: '#64748b',

  // Outlines & Borders
  border: '#cbd5e1',
  borderLight: '#e2e8f0',
  borderDark: '#94a3b8',
  outline: '#707881',

  // Feedback & Status Colors (High Contrast WCAG AA)
  success: '#006b2c',
  successContainer: '#dcfce7',
  onSuccess: '#ffffff',
  onSuccessContainer: '#052e16',

  warning: '#b45309',
  warningContainer: '#fef3c7',
  onWarning: '#ffffff',
  onWarningContainer: '#78350f',

  error: '#dc2626',
  errorContainer: '#fee2e2',
  onError: '#ffffff',
  onErrorContainer: '#7f1d1d',

  info: '#0284c7',
  infoContainer: '#e0f2fe',
  onInfo: '#ffffff',
  onInfoContainer: '#0c4a6e',

  // Offline & Synchronization states
  offline: '#64748b',
  syncing: '#0284c7',
  pendingSync: '#d97706',
  syncFailed: '#dc2626',
} as const;

export type ColorToken = keyof typeof colors;
