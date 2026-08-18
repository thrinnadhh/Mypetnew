import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { getCatalogRoute } from '@/services/route-catalog';

export default function LegacyCommerceCategoryRedirect() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const definition = getCatalogRoute(slug);

  if (!definition) {
    return <Redirect href="/stores" />;
  }

  const canonicalCategory = definition.onlyNewArrivals
    ? 'new-arrivals'
    : definition.category ?? definition.slug;

  return <Redirect href={`/category/${canonicalCategory}` as never} />;
}
