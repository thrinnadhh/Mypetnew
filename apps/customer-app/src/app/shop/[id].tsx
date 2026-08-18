import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ProviderProfileTemplate } from '@/components/commerce/ProviderProfileTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { ShopProfileData } from '@/services/catalog-data';
import { fetchPublicOutlet, fetchShopProfile } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';
import {
  CUSTOMER_CATALOG_PAGE_SIZE,
  fetchProductCatalogPage,
  mergeUniqueProducts,
} from '@/services/paginated-catalog';
import { appConfig } from '@/utils/app-config';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function ShopProfileScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(id) ? id[0] : id;
  const outletId = rawId?.trim() ?? '';

  const [shop, setShop] = useState<ShopProfileData | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [hasNext, setHasNext] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    loadingMoreRef.current = false;
    setLoadingMore(false);
    setLoadMoreError(null);

    if (!outletId) {
      setShop(null);
      setState('error');
      return;
    }

    setState('loading');
    setShop(null);

    try {
      if (appConfig.allowDemoMode) {
        const demoShop = await fetchShopProfile(outletId);
        if (requestGeneration.current !== generation) return;
        setShop(demoShop);
        setHasNext(false);
        setState('ready');
        return;
      }

      const outlet = await fetchPublicOutlet(outletId);
      if (!outlet.capabilities.includes('PRODUCT_STORE')) {
        throw new Error('OUTLET_NOT_PRODUCT_STORE');
      }

      const firstPage = await fetchProductCatalogPage({
        outletId,
        sort: 'NAME',
        page: 0,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;

      setShop({
        id: outlet.id,
        name: outlet.name,
        pickupEnabled: outlet.pickupEnabled,
        organizationId: outlet.organizationId,
        categories: [],
        products: firstPage.items,
      });
      setHasNext(firstPage.hasNext);
      setNextPage(firstPage.page + 1);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setShop(null);
      setHasNext(false);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [outletId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadNextPage = useCallback(async () => {
    if (!shop || !hasNext || loadingMoreRef.current || appConfig.allowDemoMode) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const generation = requestGeneration.current;

    try {
      const response = await fetchProductCatalogPage({
        outletId: shop.id,
        sort: 'NAME',
        page: nextPage,
        pageSize: CUSTOMER_CATALOG_PAGE_SIZE,
      });
      if (requestGeneration.current !== generation) return;
      setShop((current) => current
        ? { ...current, products: mergeUniqueProducts(current.products, response.items) }
        : current);
      setHasNext(response.hasNext);
      setNextPage(response.page + 1);
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setLoadMoreError(
        isOfflineError(error)
          ? 'Reconnect to load more products from this store.'
          : 'Could not load more products from this store.',
      );
    } finally {
      if (requestGeneration.current === generation) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNext, nextPage, shop]);

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Pet store" />}>
        <StateView kind="loading" title="Loading live store catalog" />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error' || !shop) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Pet store" />}>
        <StateView
          kind={state === 'offline' ? 'offline' : 'error'}
          title={state === 'offline' ? 'You are offline' : 'Store unavailable'}
          message={
            state === 'offline'
              ? 'Reconnect to load current store inventory.'
              : 'This store is not an active public product store or could not be loaded.'
          }
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  return (
    <ProviderProfileTemplate
      shop={shop}
      hasNext={hasNext}
      loadingMore={loadingMore}
      loadMoreError={loadMoreError}
      onLoadMore={() => void loadNextPage()}
    />
  );
}
