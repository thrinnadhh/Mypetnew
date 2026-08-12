import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { CommerceProduct } from '@/services/catalog-data';
import { fetchCommerceProducts } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';
import { getCatalogRoute } from '@/services/route-catalog';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function CommerceRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const router = useRouter();
  const definition = useMemo(() => getCatalogRoute(slug), [slug]);
  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!definition) {
      setProducts([]);
      setState('ready');
      return;
    }
    setState('loading');
    try {
      setProducts(await fetchCommerceProducts({
        category: definition.category,
        onlyNewArrivals: definition.onlyNewArrivals,
      }));
      setState('ready');
    } catch (error) {
      setProducts([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [definition]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!definition) {
    return (
      <ScreenShell header={<AppBar title="Pet store" />} testID="unknown-commerce-route">
        <StateView
          kind="empty"
          title="Category unavailable"
          message="This category is not available in the selected launch market yet."
          actionLabel="Back to shops"
          onAction={() => router.replace('/commerce' as never)}
        />
      </ScreenShell>
    );
  }

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={definition.title} />}>
        <StateView kind="loading" title="Loading live products" />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={definition.title} />}>
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Catalog unavailable'}
          message={state === 'offline' ? 'Reconnect to verify current inventory.' : 'Could not load this category.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  return (
    <CategoryTemplate
      title={definition.title}
      subtitle={definition.subtitle}
      products={products}
    />
  );
}
