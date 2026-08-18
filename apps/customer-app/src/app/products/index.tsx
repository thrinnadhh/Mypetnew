import React from 'react';

import { CategoryTemplate } from '@/components/commerce/CategoryTemplate';
import { useLocation } from '@/context/LocationContext';

export default function ProductsScreen() {
  const { selectedPincode } = useLocation();
  const catalogQuery = {
    kind: 'PRODUCT' as const,
    commerceMode: 'COMMERCE' as const,
    sort: 'NAME' as const,
    pincode: selectedPincode,
  };

  return (
    <CategoryTemplate
      title="All Products"
      subtitle={`Live stock serving PIN ${selectedPincode}`}
      catalogQuery={catalogQuery}
      backFallback="/stores"
    />
  );
}
