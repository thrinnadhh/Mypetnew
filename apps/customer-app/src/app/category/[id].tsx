import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { PublicCatalogQuery } from '@/services/customer-catalog';

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

function queryCategory(category: string): string | undefined {
  if (category === 'new-arrivals') return undefined;
  if (category === 'apparel' || category === 'appearance') return 'travel';
  return category;
}

function catalogQueryFor(category: string): PublicCatalogQuery {
  if (category === 'medicines') {
    return {
      kind: 'MEDICINE',
      commerceMode: 'VIEW_ONLY',
      sort: 'NAME',
    };
  }

  return {
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    category: queryCategory(category),
    sort: category === 'new-arrivals' ? 'NEWEST' : 'NAME',
  };
}

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const router = useRouter();
  const rawId = Array.isArray(id) ? id[0] : id;
  const catKey = rawId?.trim().toLowerCase() ?? '';
  const title = CATEGORY_NAMES[catKey];

  if (!title) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Pet store" />}>
        <StateView
          kind="empty"
          title="Category unavailable"
          message="This category is not part of the current public catalogue."
          actionLabel="Back to stores"
          onAction={() => router.replace('/stores' as never)}
        />
      </ScreenShell>
    );
  }

  const isMedicineDiscovery = catKey === 'medicines';

  return (
    <CategoryTemplate
      title={title}
      subtitle={
        isMedicineDiscovery
          ? 'Discovery only · medicines cannot be added to cart or purchased in MyPet'
          : 'Live stock from verified local stores'
      }
      catalogQuery={catalogQueryFor(catKey)}
      backFallback="/stores"
    />
  );
}
