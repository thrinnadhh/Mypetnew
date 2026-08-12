import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { appConfig } from '@/utils/app-config';

export interface FavouriteItem {
  id?: string;
  targetType: 'PRODUCT' | 'SHOP';
  targetId: string;
  createdAt?: string;
}

interface FavouritesContextType {
  favourites: FavouriteItem[];
  loading: boolean;
  isFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => boolean;
  toggleFavourite: (targetType: 'PRODUCT' | 'SHOP', targetId: string) => Promise<boolean>;
}

const FavouritesContext = createContext<FavouritesContextType | null>(null);
const STORAGE_KEY = 'mypet_favourites_v2_guest';

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function serverError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || `Favourite request failed (${response.status})`);
}

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const [favourites, setFavourites] = useState<FavouriteItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadFavourites = async () => {
      setLoading(true);
      try {
        if (session?.access_token) {
          const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/customer/favourites`, {
            headers: authHeaders(session.access_token),
          });
          if (!response.ok) throw await serverError(response);
          const data = (await response.json()) as FavouriteItem[];
          if (active) setFavourites(Array.isArray(data) ? data : []);
        } else {
          const stored = await AsyncStorage.getItem(STORAGE_KEY);
          if (active) setFavourites(stored ? (JSON.parse(stored) as FavouriteItem[]) : []);
        }
      } catch (error) {
        console.warn('Failed to load favourites', error);
        if (active) setFavourites([]);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadFavourites();
    return () => {
      active = false;
    };
  }, [session?.access_token, user?.id]);

  const isFavourite = useCallback(
    (targetType: 'PRODUCT' | 'SHOP', targetId: string): boolean =>
      favourites.some(
        (favourite) =>
          favourite.targetType.toUpperCase() === targetType.toUpperCase() &&
          favourite.targetId === targetId,
      ),
    [favourites],
  );

  const toggleFavourite = useCallback(
    async (targetType: 'PRODUCT' | 'SHOP', targetId: string): Promise<boolean> => {
      const normalizedType = targetType.toUpperCase() as 'PRODUCT' | 'SHOP';
      const currentlyFavourite = favourites.some(
        (favourite) =>
          favourite.targetType.toUpperCase() === normalizedType &&
          favourite.targetId === targetId,
      );

      if (!session?.access_token) {
        await requireAuth({ action: 'FAVOURITE', returnTo: '/favourites' });
        return currentlyFavourite;
      }

      try {
        if (currentlyFavourite) {
          const response = await fetch(
            `${appConfig.apiBaseUrl}/api/v1/customer/favourites?targetType=${encodeURIComponent(normalizedType)}&targetId=${encodeURIComponent(targetId)}`,
            {
              method: 'DELETE',
              headers: authHeaders(session.access_token),
            },
          );
          if (!response.ok) throw await serverError(response);
          setFavourites((current) =>
            current.filter(
              (favourite) =>
                !(
                  favourite.targetType.toUpperCase() === normalizedType &&
                  favourite.targetId === targetId
                ),
            ),
          );
          return false;
        }

        const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/customer/favourites`, {
          method: 'POST',
          headers: authHeaders(session.access_token),
          body: JSON.stringify({ targetType: normalizedType, targetId }),
        });
        if (!response.ok) throw await serverError(response);
        const saved = (await response.json().catch(() => null)) as FavouriteItem | null;
        const newItem: FavouriteItem = saved?.targetId
          ? saved
          : { targetType: normalizedType, targetId, createdAt: new Date().toISOString() };
        setFavourites((current) => [
          newItem,
          ...current.filter(
            (favourite) =>
              !(
                favourite.targetType.toUpperCase() === normalizedType &&
                favourite.targetId === targetId
              ),
          ),
        ]);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not update favourite.';
        Alert.alert('Favourite not updated', message);
        return currentlyFavourite;
      }
    },
    [favourites, requireAuth, session],
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
