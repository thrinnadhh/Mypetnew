import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { normalizeRouteParam } from '@/services/route-catalog';

function destination(kindValue: string, idValue: string) {
  const id = encodeURIComponent(idValue);
  if (kindValue === 'product') return `/commerce/product-detail?id=${id}`;
  if (kindValue === 'shop' || kindValue === 'store') return `/shop/${id}`;
  if (kindValue === 'hospital' || kindValue === 'vet') return `/hospital/${id}`;
  if (kindValue === 'groomer' || kindValue === 'grooming') return `/groomer/${id}`;
  if (kindValue === 'guide') return `/guide/${id}`;
  if (kindValue === 'order') return `/orders/${id}`;
  if (kindValue === 'appointment') return `/appointments/${id}`;
  return '/home';
}

export default function DetailsRoute() {
  const { kind, id } = useLocalSearchParams<{ kind?: string | string[]; id?: string | string[] }>();
  const normalizedKind = normalizeRouteParam(kind);
  const normalizedId = normalizeRouteParam(id);
  return <Redirect href={destination(normalizedKind, normalizedId || 'unknown') as never} />;
}
