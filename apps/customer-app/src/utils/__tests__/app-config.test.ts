import { resolveEnvironment, requireMobileConfig } from '../app-config';

describe('App configuration environment validation', () => {
  it('defaults to development in dev environment when EXPO_PUBLIC_APP_ENV is omitted', () => {
    expect(resolveEnvironment(undefined, true)).toBe('development');
  });

  it('accepts valid environment values', () => {
    expect(resolveEnvironment('development', true)).toBe('development');
    expect(resolveEnvironment('staging', true)).toBe('staging');
    expect(resolveEnvironment('production', true)).toBe('production');
  });

  it('rejects invalid EXPO_PUBLIC_APP_ENV values', () => {
    expect(() => resolveEnvironment('sandbox', true)).toThrow(
      "Invalid EXPO_PUBLIC_APP_ENV: 'sandbox'. Must be one of: development, staging, production.",
    );
    expect(() => resolveEnvironment('prod', true)).toThrow(
      "Invalid EXPO_PUBLIC_APP_ENV: 'prod'. Must be one of: development, staging, production.",
    );
  });

  it('fails closed in non-dev release builds when EXPO_PUBLIC_APP_ENV is set to development', () => {
    const originalEnv = process.env.EXPO_PUBLIC_APP_ENV;
    const originalDev = (global as any).__DEV__;
    (global as any).__DEV__ = false;
    process.env.EXPO_PUBLIC_APP_ENV = 'development';
    try {
      expect(() => requireMobileConfig()).toThrow(
        "EXPO_PUBLIC_APP_ENV cannot be 'development' in release builds.",
      );
    } finally {
      process.env.EXPO_PUBLIC_APP_ENV = originalEnv;
      (global as any).__DEV__ = originalDev;
    }
  });
});
