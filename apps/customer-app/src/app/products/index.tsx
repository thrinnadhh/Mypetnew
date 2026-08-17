import React, { useCallback, useEffect, useState } from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { CommerceProduct } from '@/services/catalog-data';
import { fetchCommerceProducts } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function ProductsScreen() {
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      setProducts(await fetchCommerceProducts());
      setState('ready');
    } catch (error) {
      setProducts([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="All Products" />}>
        <StateView
          kind="loading"
          title="Loading live products"
          message="Checking current stock and prices from verified local stores…"
        />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="All Products" />}>
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Catalog unavailable'}
          message={state === 'offline' ? 'Reconnect to load current inventory and prices.' : 'The live catalog could not be loaded.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  return (
    <CategoryTemplate
      title="All Products"
      subtitle="Live stock from verified local stores"
      products={products}
    />
  );
}
