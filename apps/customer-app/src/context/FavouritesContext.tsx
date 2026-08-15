import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { appConfig } from '@/utils/app-config';

export interface FavouriteItem {
  id?: string;
  targetType: 'PRODUCT' | 'SHOP';
  targetId: string;
  createdAt?: string;
}

interface FavouritePage {
  items: Array<{ listingId: string; createdAt: string }>;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

interface FavouritesContextType {
  favourites: FavouriteItem[];
  loading: boolean;
  isFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => boolean;
  toggleFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => Promise<boolean>;
}

const FavouritesContext = createContext<FavouritesContextType | null>(null);
const STORAGE_KEY = 'mypet_favourites_v3_local';

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
}

async function serverError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Favourite request failed (${response.status})`);
}

function normalizeLocal(items: FavouriteItem[]): FavouriteItem[] {
  const unique = new Map<string, FavouriteItem>();
  for (const item of items) {
    if ((item.targetType === 'PRODUCT' || item.targetType === 'SHOP') && item.targetId) {
      unique.set(`${item.targetType}:${item.targetId}`, item);
    }
  }
  return [...unique.values()];
}

async function loadLocal(): Promise<FavouriteItem[]> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return normalizeLocal(JSON.parse(stored) as FavouriteItem[]);
  } catch {
    return [];
  }
}

async function saveLocal(items: FavouriteItem[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeLocal(items)));
}

async function fetchAllServerProducts(accessToken: string): Promise<FavouriteItem[]> {
  const result: FavouriteItem[] = [];
  for (let page = 0; page < 100; page += 1) {
    const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/customer/favourites?page=${page}&pageSize=100`, {
      headers: authHeaders(accessToken),
    });
    if (!response.ok) throw await serverError(response);
    const body = (await response.json()) as FavouritePage;
    result.push(
      ...body.items.map((item) => ({
        targetType: 'PRODUCT' as const,
        targetId: item.listingId,
        createdAt: item.createdAt,
      })),
    );
    if (!body.hasNext) return result;
  }
  throw new Error('Favourite pagination exceeded the supported client bound.');
}

async function putProduct(accessToken: string, listingId: string): Promise<FavouriteItem> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/customer/favourites/${encodeURIComponent(listingId)}`,
    { method: 'PUT', headers: authHeaders(accessToken) },
  );
  if (!response.ok) throw await serverError(response);
  const body = (await response.json()) as { listingId: string; createdAt: string };
  return { targetType: 'PRODUCT', targetId: body.listingId, createdAt: body.createdAt };
}

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const [favourites, setFavourites] = useState<FavouriteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadFavourites = async () => {
      setLoading(true);
      try {
        const local = await loadLocal();
        if (!session?.accessToken) {
          if (active) setFavourites(local);
          return;
        }

        let serverProducts = await fetchAllServerProducts(session.accessToken);
        const localProducts = local.filter((item) => item.targetType === 'PRODUCT');
        const localShops = local.filter((item) => item.targetType === 'SHOP');
        const serverIds = new Set(serverProducts.map((item) => item.targetId));

        for (const product of localProducts) {
          if (!serverIds.has(product.targetId)) {
            const saved = await putProduct(session.accessToken, product.targetId);
            serverProducts = [saved, ...serverProducts];
            serverIds.add(product.targetId);
          }
        }

        // Product favourites become server-owned after sign-in. Shop favourites are intentionally local until a
        // canonical outlet-favourite contract is approved; P3 does not send them through the old generic API.
        await saveLocal(localShops);
        if (active) setFavourites(normalizeLocal([...serverProducts, ...localShops]));
      } catch (error) {
        console.warn('Failed to load favourites', error);
        const local = await loadLocal();
        if (active) setFavourites(local);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadFavourites();
    return () => {
      active = false;
    };
  }, [session?.accessToken]);

  const isFavourite = useCallback(
    (targetType: 'PRODUCT' | 'SHOP', targetId: string): boolean =>
      favourites.some((favourite) => favourite.targetType === targetType && favourite.targetId === targetId),
    [favourites],
  );

  const toggleFavourite = useCallback(
    async (targetType: 'PRODUCT' | 'SHOP', targetId: string): Promise<boolean> => {
      const currentlyFavourite = favourites.some(
        (favourite) => favourite.targetType === targetType && favourite.targetId === targetId,
      );

      try {
        if (targetType === 'SHOP' || !session?.accessToken) {
          const next = currentlyFavourite
            ? favourites.filter((item) => !(item.targetType === targetType && item.targetId === targetId))
            : [{ targetType, targetId, createdAt: new Date().toISOString() }, ...favourites];
          setFavourites(normalizeLocal(next));
          const localOnly = session?.accessToken
            ? next.filter((item) => item.targetType === 'SHOP')
            : next;
          await saveLocal(localOnly);
          return !currentlyFavourite;
        }

        if (currentlyFavourite) {
          const response = await fetch(
            `${appConfig.apiBaseUrl}/api/v1/customer/favourites/${encodeURIComponent(targetId)}`,
            { method: 'DELETE', headers: authHeaders(session.accessToken) },
          );
          if (!response.ok) throw await serverError(response);
          setFavourites((current) =>
            current.filter((item) => !(item.targetType === 'PRODUCT' && item.targetId === targetId)),
          );
          return false;
        }

        const saved = await putProduct(session.accessToken, targetId);
        setFavourites((current) => normalizeLocal([saved, ...current]));
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not update favourite.';
        Alert.alert('Favourite not updated', message);
        return currentlyFavourite;
      }
    },
    [favourites, session?.accessToken],
  );

  return (
    <FavouritesContext.Provider value={{ favourites, loading, isFavourite, toggleFavourite }}>
      {children}
    </FavouritesContext.Provider>
  );
}

export function useFavourites() {
  const context = useContext(FavouritesContext);
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider');
  return context;
}
