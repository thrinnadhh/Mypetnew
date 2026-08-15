import { resolveEnvironment } from '../app-config';

describe('App configuration environment validation', () => {
  describe('Development build (isDev = true)', () => {
    it('1. missing EXPO_PUBLIC_APP_ENV defaults to development', () => {
      expect(resolveEnvironment(undefined, true)).toBe('development');
    });

    it('2. development environment allows development', () => {
      expect(resolveEnvironment('development', true)).toBe('development');
    });

    it('3. staging environment allows staging', () => {
      expect(resolveEnvironment('staging', true)).toBe('staging');
    });

    it('4. production environment allows production', () => {
      expect(resolveEnvironment('production', true)).toBe('production');
    });

    it('5. invalid value throws error', () => {
      expect(() => resolveEnvironment('sandbox', true)).toThrow(
        "Invalid EXPO_PUBLIC_APP_ENV: 'sandbox'. Must be one of: development, staging, production.",
      );
    });
  });

  describe('Release build (isDev = false)', () => {
    it('1. missing EXPO_PUBLIC_APP_ENV throws error', () => {
      expect(() => resolveEnvironment(undefined, false)).toThrow(
        'EXPO_PUBLIC_APP_ENV is required and cannot be missing in release builds.',
      );
    });

    it('2. development environment throws error', () => {
      expect(() => resolveEnvironment('development', false)).toThrow(
        "EXPO_PUBLIC_APP_ENV cannot be 'development' in release builds.",
      );
    });

    it('3. invalid environment value throws error', () => {
      expect(() => resolveEnvironment('sandbox', false)).toThrow(
        "Invalid EXPO_PUBLIC_APP_ENV: 'sandbox'. Must be one of: development, staging, production.",
      );
    });

    it('4. staging environment is allowed', () => {
      expect(resolveEnvironment('staging', false)).toBe('staging');
    });

    it('5. production environment is allowed', () => {
      expect(resolveEnvironment('production', false)).toBe('production');
    });
  });
});
