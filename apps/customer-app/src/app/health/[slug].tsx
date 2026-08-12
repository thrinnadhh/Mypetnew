import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { normalizeRouteParam } from '@/services/route-catalog';

const HEALTH_ROUTES: Record<string, '/health/reports' | '/health/vaccinations'> = {
  reports: '/health/reports',
  'medical-reports': '/health/reports',
  vaccinations: '/health/vaccinations',
  'vaccinations-tablets': '/health/vaccinations',
};

export default function HealthRoute() {
  const { slug } = useLocalSearchParams<{ slug?: string | string[] }>();
  const route = HEALTH_ROUTES[normalizeRouteParam(slug)] ?? '/health/reports';
  return <Redirect href={route as never} />;
}
