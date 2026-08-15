import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { normalizeRouteParam } from '@/services/route-catalog';

const GUIDE_IDS = new Set([
  'coat-skin-health',
  'puppy-growth-2-12-mo',
  'puppy-nutrition-0-2-mo',
]);

export default function GuidesRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const requested = normalizeRouteParam(slug);
  const guideId = GUIDE_IDS.has(requested) ? requested : 'coat-skin-health';
  return <Redirect href={`/guide/${guideId}` as never} />;
}
