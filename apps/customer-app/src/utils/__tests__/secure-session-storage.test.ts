const createClientMock = jest.fn((_url: string, _key: string, _options: unknown) => ({ auth: {} }));
const getItemAsync = jest.fn();
const setItemAsync = jest.fn();
const deleteItemAsync = jest.fn();

function loadStorage(os: 'ios' | 'web') {
  jest.resetModules();
  createClientMock.mockClear();
  getItemAsync.mockReset();
  setItemAsync.mockReset();
  deleteItemAsync.mockReset();

  jest.doMock('react-native-url-polyfill/auto', () => ({}));
  jest.doMock('@supabase/supabase-js', () => ({ createClient: createClientMock }));
  jest.doMock('expo-secure-store', () => ({
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync,
    setItemAsync,
    deleteItemAsync,
  }));
  jest.doMock('react-native', () => ({ Platform: { OS: os } }));
  jest.doMock('@/utils/app-config', () => ({
    appConfig: {
      supabaseUrl: 'https://project.supabase.co',
      supabaseAnonKey: 'anon-key',
    },
    requireMobileConfig: jest.fn(),
  }));

  jest.isolateModules(() => {
    require('../supabase');
  });

  const options = createClientMock.mock.calls[0][2] as {
    auth: {
      storage: {
        getItem(key: string): Promise<string | null> | string | null;
        setItem(key: string, value: string): Promise<void> | void;
        removeItem(key: string): Promise<void> | void;
      };
      autoRefreshToken: boolean;
      persistSession: boolean;
      detectSessionInUrl: boolean;
    };
  };
  return options.auth;
}

describe('Supabase session storage', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('uses device-only SecureStore and chunks large native sessions', async () => {
    const auth = loadStorage('ios');
    getItemAsync.mockImplementation(async (key: string) => key === 'session.count' ? '2' : null);
    const value = 'x'.repeat(3_700);

    await auth.storage.setItem('session', value);

    expect(deleteItemAsync).toHaveBeenCalledWith('session.0');
    expect(deleteItemAsync).toHaveBeenCalledWith('session.1');
    expect(deleteItemAsync).toHaveBeenCalledWith('session.count');
    expect(deleteItemAsync).toHaveBeenCalledWith('session');
    expect(setItemAsync).toHaveBeenCalledTimes(4);
    expect(setItemAsync).toHaveBeenNthCalledWith(
      1,
      'session.0',
      'x'.repeat(1_800),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(setItemAsync).toHaveBeenNthCalledWith(
      2,
      'session.1',
      'x'.repeat(1_800),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(setItemAsync).toHaveBeenNthCalledWith(
      3,
      'session.2',
      'x'.repeat(100),
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(setItemAsync).toHaveBeenNthCalledWith(
      4,
      'session.count',
      '3',
      { keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' },
    );
    expect(auth).toMatchObject({
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    });
  });

  it('reassembles all native chunks and fails closed when one is missing', async () => {
    const auth = loadStorage('ios');
    getItemAsync.mockImplementation(async (key: string) => ({
      'session.count': '3',
      'session.0': 'alpha-',
      'session.1': 'beta-',
      'session.2': 'gamma',
    }[key] ?? null));

    await expect(auth.storage.getItem('session')).resolves.toBe('alpha-beta-gamma');

    getItemAsync.mockImplementation(async (key: string) => ({
      'session.count': '2',
      'session.0': 'partial',
      'session.1': null,
    }[key] ?? null));
    await expect(auth.storage.getItem('session')).resolves.toBeNull();
  });

  it('falls back to the unchunked native key and removes all recorded chunks', async () => {
    const auth = loadStorage('ios');
    getItemAsync.mockImplementation(async (key: string) => {
      if (key === 'session.count') return '0';
      if (key === 'session') return 'small-session';
      return null;
    });

    await expect(auth.storage.getItem('session')).resolves.toBe('small-session');

    getItemAsync.mockResolvedValueOnce('2');
    await auth.storage.removeItem('session');
    expect(deleteItemAsync).toHaveBeenCalledWith('session.0');
    expect(deleteItemAsync).toHaveBeenCalledWith('session.1');
    expect(deleteItemAsync).toHaveBeenCalledWith('session.count');
    expect(deleteItemAsync).toHaveBeenCalledWith('session');
  });

  it('uses browser localStorage on web and keeps session URL detection disabled', async () => {
    const values = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    };
    const auth = loadStorage('web');

    await auth.storage.setItem('session', 'web-session');
    expect(await auth.storage.getItem('session')).toBe('web-session');
    await auth.storage.removeItem('session');
    expect(await auth.storage.getItem('session')).toBeNull();
    expect(getItemAsync).not.toHaveBeenCalled();
    expect(auth.detectSessionInUrl).toBe(false);
  });
});
