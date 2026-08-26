import { ApiError } from '@/contracts/api-error';
import { SAMPLE_PRODUCTS } from '@/demo/catalog-data';
import { apiClient } from '@/services/api-client';
import { fetchShopProfile, fetchCommerceProduct, fetchCommerceProducts } from '@/services/customer-catalog';
import { DEMO_PROVIDER_FIXTURES } from '@/demo/customer-data';
import { fetchCommerceCatalogPage, fetchServiceableProductStore } from '@/services/paginated-catalog';

/**
 * Demo mode is hard-disabled for this file: every catalog/store entry point must
 * take the live backend path and PROPAGATE its failures. A regression that
 * swallowed a backend outage into SAMPLE_PRODUCTS/DEMO_PROVIDER_FIXTURES would
 * resolve instead of rejecting and fail these tests.
 */
jest.mock('@/utils/app-config', () => {
  const actual = jest.requireActual<typeof import('@/utils/app-config')>('@/utils/app-config');
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      allowDemoMode: false,
    },
  };
});

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function toSettled<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error) => ({ ok: false as const, error }),
  );
}

describe('H2 catalog services never fall back to demo fixtures', () => {
  let getSpy: jest.Mock;
  const backendFailure = new ApiError(500, {
    code: 'HTTP_500',
    message: 'catalog backend exploded',
    fieldErrors: {},
  });

  beforeEach(() => {
    getSpy = jest.spyOn(apiClient, 'get') as unknown as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('propagates a backend 500 from fetchCommerceCatalogPage instead of returning SAMPLE_PRODUCTS', async () => {
    getSpy.mockRejectedValue(backendFailure);

    const snapshot = await toSettled(fetchCommerceCatalogPage());

    // Identity propagation proves no catch-and-fallback layer rewrote the failure.
    expect(snapshot).toEqual({ ok: false, error: backendFailure });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(String(getSpy.mock.calls[0][0])).toContain('/api/v1/public/catalog');

    // Fixtures are non-empty, so a silent demo fallback WOULD be observable data.
    expect(SAMPLE_PRODUCTS.map((product) => product.id)).toContain('p-food-1');
  });

  it('propagates a raw network failure from fetchCommerceCatalogPage without fabricating a page', async () => {
    const networkFailure = new TypeError('Network request failed');
    getSpy.mockRejectedValue(networkFailure);

    const snapshot = await toSettled(fetchCommerceCatalogPage({ q: 'dog food' }));

    expect(snapshot).toEqual({ ok: false, error: networkFailure });
  });

  it('propagates a backend failure from fetchServiceableProductStore with canonical outlet query', async () => {
    getSpy.mockRejectedValue(backendFailure);

    const snapshot = await toSettled(fetchServiceableProductStore('outlet-9', '517501'));

    expect(snapshot).toEqual({ ok: false, error: backendFailure });
    const requestedUrl = String(getSpy.mock.calls[0][0]);
    expect(requestedUrl).toContain('/api/v1/public/outlets/outlet-9');
    expect(requestedUrl).toContain('capability=PRODUCT_STORE');
    expect(requestedUrl).toContain('pincode=517501');
  });

  it('fails closed on an invalid service PIN before any network call or fixture access', async () => {
    await expect(fetchServiceableProductStore('outlet-9', '12ab')).rejects.toThrow(
      'A valid active six-digit service PIN is required',
    );
    await expect(fetchServiceableProductStore('outlet-9', '')).rejects.toThrow(Error);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('propagates failures from fetchShopProfile instead of returning DEMO_PROVIDER_FIXTURES shape', async () => {
    getSpy.mockRejectedValue(backendFailure);

    const snapshot = await toSettled(fetchShopProfile('the-healthy-hound'));

    expect(snapshot).toEqual({ ok: false, error: backendFailure });
    // Sentinel proves the demo fixture exists and was reachable-by-id if the gate leaked.
    expect(DEMO_PROVIDER_FIXTURES.PET_STORE.some((shop) => shop.id === 'the-healthy-hound')).toBe(true);
    expect(String(getSpy.mock.calls[0][0])).toContain('/api/v1/public/outlets/the-healthy-hound');
  });

  it('propagates failures from fetchCommerceProducts instead of returning the sample catalog array', async () => {
    getSpy.mockRejectedValue(backendFailure);

    const snapshot = await toSettled(fetchCommerceProducts());

    expect(snapshot).toEqual({ ok: false, error: backendFailure });
  });

  it('takes the live listing-detail path in fetchCommerceProduct even for a known demo product id', async () => {
    getSpy.mockRejectedValue(backendFailure);

    const snapshot = await toSettled(fetchCommerceProduct('p-food-1'));

    expect(snapshot).toEqual({ ok: false, error: backendFailure });
    expect(String(getSpy.mock.calls[0][0])).toContain('/api/v1/public/catalog/p-food-1');
  });
});

describe('H2 requireMobileConfig release gating', () => {
  const ENV_KEYS = [
    'EXPO_PUBLIC_APP_ENV',
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_ALLOW_DEMO_MODE',
  ] as const;

  type EnvKey = (typeof ENV_KEYS)[number];

  interface LoadedConfig {
    requireMobileConfig: () => void;
    appConfig: typeof import('@/utils/app-config').appConfig;
    restore: () => void;
  }

  function loadFreshAppConfig(dev: boolean, env: Record<EnvKey, string | undefined>): LoadedConfig {
    const savedEnv = new Map<string, string | undefined>(
      ENV_KEYS.map((key) => [key, process.env[key]]),
    );
    const globalWithDev = globalThis as { __DEV__?: boolean };
    const previousDev = globalWithDev.__DEV__;

    for (const key of ENV_KEYS) {
      const value = env[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalWithDev.__DEV__ = dev;
    jest.resetModules();

    const mod = jest.requireActual<typeof import('@/utils/app-config')>('@/utils/app-config');
    return {
      requireMobileConfig: mod.requireMobileConfig,
      appConfig: mod.appConfig,
      restore: () => {
        for (const [key, value] of savedEnv) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        globalWithDev.__DEV__ = previousDev;
        jest.resetModules();
      },
    };
  }

  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length > 0) {
      restores.pop()?.();
    }
  });

  it('throws in release builds when EXPO_PUBLIC_APP_ENV is missing', () => {
    const config = loadFreshAppConfig(false, {
      EXPO_PUBLIC_APP_ENV: undefined,
      EXPO_PUBLIC_API_BASE_URL: 'https://api.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(config.restore);

    expect(() => config.requireMobileConfig()).toThrow(
      'EXPO_PUBLIC_APP_ENV is required and cannot be missing in release builds.',
    );
  });

  it('accepts a complete staging configuration and trims trailing slashes off the base URL', () => {
    const config = loadFreshAppConfig(false, {
      EXPO_PUBLIC_APP_ENV: 'staging',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.mypet.example.com/',
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(config.restore);

    expect(() => config.requireMobileConfig()).not.toThrow();
    expect(config.appConfig.environment).toBe('staging');
    expect(config.appConfig.apiBaseUrl).toBe('https://api.mypet.example.com');
  });

  it('rejects non-HTTPS API base URLs in production builds', () => {
    const config = loadFreshAppConfig(false, {
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_BASE_URL: 'http://insecure.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(config.restore);

    expect(() => config.requireMobileConfig()).toThrow(
      'EXPO_PUBLIC_API_BASE_URL must use HTTPS in production builds.',
    );
  });

  it('refuses the development environment in release builds', () => {
    const config = loadFreshAppConfig(false, {
      EXPO_PUBLIC_APP_ENV: 'development',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(config.restore);

    expect(() => config.requireMobileConfig()).toThrow(
      "EXPO_PUBLIC_APP_ENV cannot be 'development' in release builds.",
    );
  });

  it('rejects unknown environment names in development builds', () => {
    const config = loadFreshAppConfig(true, {
      EXPO_PUBLIC_APP_ENV: 'bogus-env',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_URL: 'https://supabase.mypet.example.com',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(config.restore);

    expect(() => config.requireMobileConfig()).toThrow(/Invalid EXPO_PUBLIC_APP_ENV: 'bogus-env'/);
  });

  it('still demands Supabase configuration in development unless the demo escape hatch is enabled', () => {
    const withoutDemoFlag = loadFreshAppConfig(true, {
      EXPO_PUBLIC_APP_ENV: undefined,
      EXPO_PUBLIC_API_BASE_URL: undefined,
      EXPO_PUBLIC_SUPABASE_URL: undefined,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
      EXPO_PUBLIC_ALLOW_DEMO_MODE: undefined,
    });
    restores.push(withoutDemoFlag.restore);

    expect(() => withoutDemoFlag.requireMobileConfig()).toThrow(/Missing mobile configuration/);

    const withDemoFlag = loadFreshAppConfig(true, {
      EXPO_PUBLIC_APP_ENV: undefined,
      EXPO_PUBLIC_API_BASE_URL: undefined,
      EXPO_PUBLIC_SUPABASE_URL: undefined,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined,
      EXPO_PUBLIC_ALLOW_DEMO_MODE: 'true',
    });
    restores.push(withDemoFlag.restore);

    expect(() => withDemoFlag.requireMobileConfig()).not.toThrow();
  });
});
