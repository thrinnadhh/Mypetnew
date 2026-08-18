import React from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';

export default function ProductsScreen() {
  return (
    <CategoryTemplate
      title="All Products"
      subtitle="Live stock from verified local stores"
      catalogQuery={{
        kind: 'PRODUCT',
        commerceMode: 'COMMERCE',
        sort: 'NAME',
      }}
      backFallback="/stores"
    />
  );
}
