import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { CommerceProduct } from '@/services/catalog-data';
import {
  fetchAllCatalogItems,
  fetchCommerceProducts,
  mapListingToCommerceProduct,
} from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';
import { appConfig } from '@/utils/app-config';

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
  medicines: 'Medicines',
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
  const isMedicineDiscovery = catKey === 'medicines';

  const [products, setProducts] = useState<CommerceProduct[]>([]);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      if (isMedicineDiscovery) {
        if (appConfig.allowDemoMode) {
          setProducts([]);
        } else {
          const medicines = await fetchAllCatalogItems({
            kind: 'MEDICINE',
            commerceMode: 'VIEW_ONLY',
            sort: 'NAME',
          });
          setProducts(medicines.map((listing) => mapListingToCommerceProduct(listing)));
        }
      } else {
        const result = await fetchCommerceProducts({
          category: queryCategory(catKey),
          onlyNewArrivals: catKey === 'new-arrivals',
        });
        setProducts(result);
      }
      setState('ready');
    } catch (error) {
      setProducts([]);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [catKey, isMedicineDiscovery]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={title} />}>
        <StateView
          kind="loading"
          title={isMedicineDiscovery ? 'Loading medicine listings' : 'Loading live products'}
          message={
            isMedicineDiscovery
              ? 'Checking view-only medicine listings from verified local providers…'
              : 'Checking current stock and prices from verified local stores…'
          }
        />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error') {
    return (
      <ScreenShell scroll={false} header={<AppBar title={title} />}>
        <StateView
          kind={state}
          title={state === 'offline' ? 'You are offline' : 'Catalog unavailable'}
          message={
            state === 'offline'
              ? 'Reconnect to load current listings.'
              : isMedicineDiscovery
                ? 'Medicine discovery could not be loaded.'
                : 'The live catalog could not be loaded.'
          }
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  return (
    <CategoryTemplate
      title={title}
      subtitle={
        isMedicineDiscovery
          ? 'Discovery only · medicines cannot be added to cart or purchased in MyPet'
          : 'Live stock from verified local stores'
      }
      products={products}
    />
  );
}
