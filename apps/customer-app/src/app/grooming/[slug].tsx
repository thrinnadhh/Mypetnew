import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { normalizeRouteParam } from '@/services/route-catalog';

const GROOMER_IDS = new Set(['paws-bubbles-spa', 'fluffy-tails']);

export default function GroomingRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const requested = normalizeRouteParam(slug);
  const groomerId = GROOMER_IDS.has(requested) ? requested : 'paws-bubbles-spa';
  return <Redirect href={`/groomer/${groomerId}` as never} />;
}
