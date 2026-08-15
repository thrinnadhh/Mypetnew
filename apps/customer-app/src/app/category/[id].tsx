import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { CommerceProduct } from '@/services/catalog-data';
import { fetchCommerceProducts } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

const CATEGORY_NAMES: Record<string, string> = {
  food: 'Food & Nutrition',
  furniture: 'Furniture & Sleep',
  toys: 'Toys & Enrichment',
  travel: 'Travel & Apparel',
  apparel: 'Travel & Apparel',
  appearance: 'Travel & Apparel',
  treats: 'Treats & Chews',
  waste: 'Waste Management',
  'new-arrivals': 'New Arrivals',
  grooming: 'Grooming Services & Kits',
  hospitals: 'Hospitals & Vet Services',
  vaccinations: 'Vaccinations & Deworming',
};

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

function queryCategory(category: string): string | undefined {
  if (category === 'new-arrivals') return undefined;
  if (category === 'apparel' || category === 'appearance') return 'travel';
  return category;
}

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const catKey = (id ?? 'food').toLowerCase();
  const title = CATEGORY_NAMES[catKey] ?? (catKey.charAt(0).toUpperCase() + catKey.slice(1));

  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const result = await fetchCommerceProducts({
        category: queryCategory(catKey),
        onlyNewArrivals: catKey === 'new-arrivals',
      });
      setProducts(result);
      setState('ready');
    } catch (error) {
      setProducts([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [catKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={title} />}>
        <StateView kind="loading" title="Loading live products" message="Checking current stock and prices from verified local stores…" />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={title} />}>
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

  return <CategoryTemplate title={title} subtitle="Live stock from verified local stores" products={products} />;
}
