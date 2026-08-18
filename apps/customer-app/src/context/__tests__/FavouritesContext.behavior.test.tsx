import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { FavouritesProvider, useFavourites } from '../FavouritesContext';

const mockStorage = new Map<string, string>();
const mockApiGet = jest.fn();
const mockApiPut = jest.fn();
const mockApiDelete = jest.fn();
let mockAuthEpoch = 0;
let mockSession: { accountId: string; accessToken: string } | null = null;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStorage.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStorage.delete(key);
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach((key) => mockStorage.delete(key));
    }),
  },
}));

jest.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ session: mockSession }),
}));

jest.mock('@/services/api-client', () => {
  class ApiError extends Error {
    status: number;

    constructor(status: number, message = 'API error') {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError,
    apiClient: {
      getAuthEpoch: () => mockAuthEpoch,
      get: (...args: unknown[]) => mockApiGet(...args),
      put: (...args: unknown[]) => mockApiPut(...args),
      delete: (...args: unknown[]) => mockApiDelete(...args),
    },
  };
});

type FavouriteContextValue = ReturnType<typeof useFavourites>;
let latest: FavouriteContextValue | null = null;

function Probe() {
  const value = useFavourites();

  React.useEffect(() => {
    latest = value;
  }, [value]);

  return null;
}

function tree() {
  return (
    <FavouritesProvider>
      <Probe />
    </FavouritesProvider>
  );
}

function emptyFavouritePage() {
  return { items: [], page: 0, pageSize: 50, hasNext: false };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('FavouritesContext P6 behaviour', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockApiGet.mockReset();
    mockApiPut.mockReset();
    mockApiDelete.mockReset();
    mockApiGet.mockResolvedValue(emptyFavouritePage());
    mockApiDelete.mockResolvedValue({});
    mockAuthEpoch = 0;
    mockSession = null;
    latest = null;
  });

  it('hides User A favourites immediately when the session switches to User B', async () => {
    mockSession = { accountId: 'user-a', accessToken: 'token-a' };
    mockStorage.set('mypet_favourites_v4_account:user-a', JSON.stringify([
      { targetType: 'SHOP', targetId: 'shop-a' },
    ]));

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(tree());
    });
    await settle();
    expect(latest?.favourites).toEqual([
      expect.objectContaining({ targetType: 'SHOP', targetId: 'shop-a' }),
    ]);

    let resolveUserB!: (value: ReturnType<typeof emptyFavouritePage>) => void;
    const userBResponse = new Promise<ReturnType<typeof emptyFavouritePage>>((resolve) => {
      resolveUserB = resolve;
    });
    mockApiGet.mockImplementationOnce(() => userBResponse);
    mockSession = { accountId: 'user-b', accessToken: 'token-b' };
    mockAuthEpoch += 1;

    act(() => {
      renderer!.update(tree());
    });

    expect(latest?.favourites).toEqual([]);
    expect(latest?.loading).toBe(true);

    resolveUserB(emptyFavouritePage());
    await settle();
    expect(latest?.favourites).toEqual([]);
    expect(latest?.loading).toBe(false);
  });

  it('migrates guest products to the server and guest shops into the signed-in account bucket', async () => {
    mockStorage.set('mypet_favourites_v4_guest', JSON.stringify([
      { targetType: 'PRODUCT', targetId: 'product-1' },
      { targetType: 'SHOP', targetId: 'shop-1' },
    ]));
    mockSession = { accountId: 'user-a', accessToken: 'token-a' };
    mockApiPut.mockResolvedValue({ listingId: 'product-1', createdAt: '2026-08-18T00:00:00Z' });

    await act(async () => {
      TestRenderer.create(tree());
    });
    await settle();

    expect(mockApiPut).toHaveBeenCalledWith('/api/v1/customer/favourites/product-1');
    expect(JSON.parse(mockStorage.get('mypet_favourites_v4_guest') ?? 'null')).toEqual([]);
    expect(JSON.parse(mockStorage.get('mypet_favourites_v4_account:user-a') ?? 'null')).toEqual([
      expect.objectContaining({ targetType: 'SHOP', targetId: 'shop-1' }),
    ]);
    expect(latest?.favourites).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetType: 'PRODUCT', targetId: 'product-1' }),
      expect.objectContaining({ targetType: 'SHOP', targetId: 'shop-1' }),
    ]));
  });

  it('serializes two different shop writes so one local favourite cannot clobber the other', async () => {
    mockSession = { accountId: 'user-a', accessToken: 'token-a' };

    await act(async () => {
      TestRenderer.create(tree());
    });
    await settle();

    await act(async () => {
      await Promise.all([
        latest!.toggleFavourite('SHOP', 'shop-1'),
        latest!.toggleFavourite('SHOP', 'shop-2'),
      ]);
    });

    const stored = JSON.parse(mockStorage.get('mypet_favourites_v4_account:user-a') ?? '[]') as Array<{ targetId: string }>;
    expect(stored.map((item) => item.targetId).sort()).toEqual(['shop-1', 'shop-2']);
    expect(latest?.favourites.map((item) => item.targetId).sort()).toEqual(['shop-1', 'shop-2']);
  });

  it('serializes a rapid product double-toggle into one add followed by one remove', async () => {
    mockSession = { accountId: 'user-a', accessToken: 'token-a' };
    mockApiPut.mockResolvedValue({ listingId: 'product-1', createdAt: '2026-08-18T00:00:00Z' });

    await act(async () => {
      TestRenderer.create(tree());
    });
    await settle();

    await act(async () => {
      await Promise.all([
        latest!.toggleFavourite('PRODUCT', 'product-1'),
        latest!.toggleFavourite('PRODUCT', 'product-1'),
      ]);
    });

    expect(mockApiPut).toHaveBeenCalledTimes(1);
    expect(mockApiDelete).toHaveBeenCalledTimes(1);
    expect(latest?.isFavourite('PRODUCT', 'product-1')).toBe(false);
  });

  it('does not let an operation queued for User A execute after logout/account change', async () => {
    mockSession = { accountId: 'user-a', accessToken: 'token-a' };

    let resolveFirstPut!: (value: { listingId: string; createdAt: string }) => void;
    const firstPut = new Promise<{ listingId: string; createdAt: string }>((resolve) => {
      resolveFirstPut = resolve;
    });
    mockApiPut.mockImplementationOnce(() => firstPut);

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(tree());
    });
    await settle();

    const first = latest!.toggleFavourite('PRODUCT', 'product-1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockApiPut).toHaveBeenCalledTimes(1);

    const queued = latest!.toggleFavourite('PRODUCT', 'product-2');
    mockSession = { accountId: 'user-b', accessToken: 'token-b' };
    mockAuthEpoch += 1;
    act(() => {
      renderer!.update(tree());
    });

    resolveFirstPut({ listingId: 'product-1', createdAt: '2026-08-18T00:00:00Z' });
    await act(async () => {
      await Promise.all([first, queued]);
    });
    await settle();

    expect(mockApiPut).toHaveBeenCalledTimes(1);
    expect(latest?.favourites).toEqual([]);
    expect(mockStorage.get('mypet_favourites_v4_account:user-b')).toBeUndefined();
  });
});
