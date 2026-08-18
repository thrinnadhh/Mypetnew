import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { ApiError, apiClient } from '@/services/api-client';

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
  error: string | null;
  retry: () => Promise<void>;
  isFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => boolean;
  toggleFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => Promise<boolean>;
}

const FavouritesContext = createContext<FavouritesContextType | null>(null);

const GUEST_STORAGE_KEY = 'mypet_favourites_v4_guest';
const ACCOUNT_STORAGE_PREFIX = 'mypet_favourites_v4_account:';
const LEGACY_GUEST_STORAGE_KEY = 'mypet_favourites_v2_guest';
const AMBIGUOUS_LEGACY_STORAGE_KEY = 'mypet_favourites_v3_local';
const FAVOURITE_PAGE_SIZE = 50;

function accountStorageKey(accountId: string): string {
  return `${ACCOUNT_STORAGE_PREFIX}${accountId}`;
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

async function parseStored(key: string): Promise<FavouriteItem[]> {
  const stored = await AsyncStorage.getItem(key);
  if (!stored) return [];
  try {
    return normalizeLocal(JSON.parse(stored) as FavouriteItem[]);
  } catch {
    return [];
  }
}

async function saveStored(key: string, items: FavouriteItem[]): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(normalizeLocal(items)));
}

async function loadGuestLocal(migrateLegacy: boolean): Promise<FavouriteItem[]> {
  const current = await parseStored(GUEST_STORAGE_KEY);
  if (!migrateLegacy) return current;

  // v2 was explicitly guest-owned and is safe to migrate. v3 was shared by
  // guest and authenticated sessions, so its ownership cannot be proven after
  // upgrade. Never surface or migrate v3 into a later account; remove it to
  // fail closed against cross-account preference leakage.
  const legacyGuest = await parseStored(LEGACY_GUEST_STORAGE_KEY);
  const merged = normalizeLocal([...current, ...legacyGuest]);
  if (legacyGuest.length > 0) await saveStored(GUEST_STORAGE_KEY, merged);
  await AsyncStorage.multiRemove([LEGACY_GUEST_STORAGE_KEY, AMBIGUOUS_LEGACY_STORAGE_KEY]);
  return merged;
}

async function loadAccountLocal(accountId: string): Promise<FavouriteItem[]> {
  return parseStored(accountStorageKey(accountId));
}

async function saveAccountLocal(accountId: string, items: FavouriteItem[]): Promise<void> {
  await saveStored(accountStorageKey(accountId), items);
}

export async function clearLocalFavourites(accountId?: string): Promise<void> {
  const keys = [GUEST_STORAGE_KEY, LEGACY_GUEST_STORAGE_KEY, AMBIGUOUS_LEGACY_STORAGE_KEY];
  if (accountId) keys.push(accountStorageKey(accountId));
  await AsyncStorage.multiRemove(keys);
}

async function fetchAllServerProducts(): Promise<FavouriteItem[]> {
  const result: FavouriteItem[] = [];
  for (let page = 0; page < 100; page += 1) {
    const body = await apiClient.get<FavouritePage>(
      `/api/v1/customer/favourites?page=${page}&pageSize=${FAVOURITE_PAGE_SIZE}`,
    );
    result.push(
      ...body.items.map((item) => ({
        targetType: 'PRODUCT' as const,
        targetId: item.listingId,
        createdAt: item.createdAt,
      })),
    );
    if (!body.hasNext) return normalizeLocal(result);
  }
  throw new Error('Favourite pagination exceeded the supported client bound.');
}

async function putProduct(listingId: string): Promise<FavouriteItem> {
  const body = await apiClient.put<{ listingId: string; createdAt: string }>(
    `/api/v1/customer/favourites/${encodeURIComponent(listingId)}`,
  );
  return { targetType: 'PRODUCT', targetId: body.listingId, createdAt: body.createdAt };
}

function withoutTarget(
  items: readonly FavouriteItem[],
  targetType: 'PRODUCT' | 'SHOP',
  targetId: string,
): FavouriteItem[] {
  return items.filter((item) => !(item.targetType === targetType && item.targetId === targetId));
}

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const accountId = session?.accountId ?? null;
  const [favourites, setFavourites] = useState<FavouriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const favouritesRef = useRef<FavouriteItem[]>([]);
  const loadGenerationRef = useRef(0);
  const mutationQueueRef = useRef<Promise<boolean>>(Promise.resolve(false));

  const replaceFavourites = useCallback((items: FavouriteItem[]) => {
    const next = normalizeLocal(items);
    favouritesRef.current = next;
    setFavourites(next);
  }, []);

  const reload = useCallback(async () => {
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    const authEpoch = apiClient.getAuthEpoch();
    const accountAtStart = accountId;
    setLoading(true);
    setError(null);

    const isCurrent = () => (
      loadGenerationRef.current === generation
      && apiClient.getAuthEpoch() === authEpoch
    );

    try {
      if (!accountAtStart) {
        const guest = await loadGuestLocal(true);
        if (isCurrent()) replaceFavourites(guest);
        return;
      }

      // The explicit v4 guest bucket and the older explicitly guest-owned v2
      // bucket may migrate into the account restoring/signing in now. The
      // ownership-ambiguous v3 bucket is quarantined and discarded by
      // loadGuestLocal(true). Account-local shop state remains account-keyed.
      const [accountLocal, guestLocal, serverInitial] = await Promise.all([
        loadAccountLocal(accountAtStart),
        loadGuestLocal(true),
        fetchAllServerProducts(),
      ]);
      if (!isCurrent()) return;

      let serverProducts = serverInitial;
      const serverIds = new Set(serverProducts.map((item) => item.targetId));
      const localProducts = normalizeLocal([...accountLocal, ...guestLocal])
        .filter((item) => item.targetType === 'PRODUCT');
      const localShops = normalizeLocal([...accountLocal, ...guestLocal])
        .filter((item) => item.targetType === 'SHOP');
      const retryableLocalProducts: FavouriteItem[] = [];

      for (const product of localProducts) {
        if (!isCurrent()) return;
        if (serverIds.has(product.targetId)) continue;
        try {
          const saved = await putProduct(product.targetId);
          if (!isCurrent()) return;
          serverProducts = [saved, ...serverProducts];
          serverIds.add(product.targetId);
        } catch (migrationError) {
          if (migrationError instanceof ApiError && migrationError.status === 404) continue;
          retryableLocalProducts.push(product);
        }
      }

      if (!isCurrent()) return;
      const accountLocalNext = normalizeLocal([...localShops, ...retryableLocalProducts]);
      await Promise.all([
        saveAccountLocal(accountAtStart, accountLocalNext),
        saveStored(GUEST_STORAGE_KEY, []),
      ]);
      if (!isCurrent()) return;
      replaceFavourites([...serverProducts, ...accountLocalNext]);
    } catch (loadError) {
      if (!isCurrent()) return;
      console.warn('Failed to load favourites', loadError);
      const safeLocal = accountAtStart
        ? await loadAccountLocal(accountAtStart)
        : await loadGuestLocal(true);
      if (!isCurrent()) return;
      replaceFavourites(safeLocal);
      setError(loadError instanceof Error ? loadError.message : 'Could not load favourites.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [accountId, replaceFavourites]);

  useEffect(() => {
    void reload();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [reload, session?.accessToken]);

  const isFavourite = useCallback(
    (targetType: 'PRODUCT' | 'SHOP', targetId: string): boolean =>
      favourites.some((favourite) => favourite.targetType === targetType && favourite.targetId === targetId),
    [favourites],
  );

  const performToggle = useCallback(async (
    targetType: 'PRODUCT' | 'SHOP',
    targetId: string,
    accountAtStart: string | null,
    authEpoch: number,
  ): Promise<boolean> => {
    const currentItems = favouritesRef.current;
    const currentlyFavourite = currentItems.some(
      (favourite) => favourite.targetType === targetType && favourite.targetId === targetId,
    );
    const stillSameAccount = () => apiClient.getAuthEpoch() === authEpoch;

    if (!stillSameAccount()) return currentlyFavourite;

    try {
      if (targetType === 'SHOP') {
        const storageKey = accountAtStart ? accountStorageKey(accountAtStart) : GUEST_STORAGE_KEY;
        const local = await parseStored(storageKey);
        if (!stillSameAccount()) return currentlyFavourite;
        const nextLocal = currentlyFavourite
          ? withoutTarget(local, 'SHOP', targetId)
          : normalizeLocal([
              { targetType: 'SHOP', targetId, createdAt: new Date().toISOString() },
              ...local,
            ]);
        await saveStored(storageKey, nextLocal);
        if (!stillSameAccount()) return currentlyFavourite;
        const next = currentlyFavourite
          ? withoutTarget(favouritesRef.current, 'SHOP', targetId)
          : normalizeLocal([
              { targetType: 'SHOP', targetId, createdAt: new Date().toISOString() },
              ...favouritesRef.current,
            ]);
        replaceFavourites(next);
        return !currentlyFavourite;
      }

      if (!accountAtStart) {
        const local = await loadGuestLocal(true);
        if (!stillSameAccount()) return currentlyFavourite;
        const nextLocal = currentlyFavourite
          ? withoutTarget(local, 'PRODUCT', targetId)
          : normalizeLocal([
              { targetType: 'PRODUCT', targetId, createdAt: new Date().toISOString() },
              ...local,
            ]);
        await saveStored(GUEST_STORAGE_KEY, nextLocal);
        if (!stillSameAccount()) return currentlyFavourite;
        replaceFavourites(nextLocal);
        return !currentlyFavourite;
      }

      if (currentlyFavourite) {
        await apiClient.delete(`/api/v1/customer/favourites/${encodeURIComponent(targetId)}`);
        if (!stillSameAccount()) return currentlyFavourite;
        const accountLocal = await loadAccountLocal(accountAtStart);
        if (!stillSameAccount()) return currentlyFavourite;
        await saveAccountLocal(accountAtStart, withoutTarget(accountLocal, 'PRODUCT', targetId));
        if (!stillSameAccount()) return currentlyFavourite;
        replaceFavourites(withoutTarget(favouritesRef.current, 'PRODUCT', targetId));
        return false;
      }

      const saved = await putProduct(targetId);
      if (!stillSameAccount()) return currentlyFavourite;
      const accountLocal = await loadAccountLocal(accountAtStart);
      if (!stillSameAccount()) return currentlyFavourite;
      await saveAccountLocal(accountAtStart, withoutTarget(accountLocal, 'PRODUCT', targetId));
      if (!stillSameAccount()) return currentlyFavourite;
      replaceFavourites([saved, ...favouritesRef.current]);
      return true;
    } catch (mutationError) {
      if (!stillSameAccount()) return currentlyFavourite;
      const message = mutationError instanceof Error ? mutationError.message : 'Could not update favourite.';
      Alert.alert('Favourite not updated', message);
      return currentlyFavourite;
    }
  }, [replaceFavourites]);

  const toggleFavourite = useCallback((
    targetType: 'PRODUCT' | 'SHOP',
    targetId: string,
  ): Promise<boolean> => {
    const accountAtInvocation = accountId;
    const authEpochAtInvocation = apiClient.getAuthEpoch();
    const previous = mutationQueueRef.current;
    const next = previous
      .catch(() => false)
      .then(() => performToggle(
        targetType,
        targetId,
        accountAtInvocation,
        authEpochAtInvocation,
      ));
    mutationQueueRef.current = next;
    return next;
  }, [accountId, performToggle]);

  return (
    <FavouritesContext.Provider value={{ favourites, loading, error, retry: reload, isFavourite, toggleFavourite }}>
      {children}
    </FavouritesContext.Provider>
  );
}

export function useFavourites() {
  const context = useContext(FavouritesContext);
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider');
  return context;
}
