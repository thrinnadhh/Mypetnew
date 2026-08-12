import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { normalizeRouteParam } from '@/services/route-catalog';

const HOSPITAL_IDS = new Set(['city-pet-hospital', 'petcare-wellness']);

export default function VetRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const requested = normalizeRouteParam(slug);
  const hospitalId = HOSPITAL_IDS.has(requested) ? requested : 'city-pet-hospital';
  return <Redirect href={`/hospital/${hospitalId}` as never} />;
}
