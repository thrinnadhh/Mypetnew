import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';

import { AppBar, EntityCard, StateView, StickyCta } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { useTranslation } from '@/i18n';
import { isOfflineError } from '@/services/customer-profile';
import { fetchProviderProfile, type ProviderProfile } from '@/services/provider-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';
export default function ProviderProfileScreen() {
  const { id, type } = useLocalSearchParams<{ id?: string; type?: string }>();
  const providerId = Array.isArray(id) ? id[0] : id;
  const providerType = Array.isArray(type) ? type[0] : type;
  const router = useRouter();
  const { t } = useTranslation();
  const { requireAuth } = useAuthIntent();
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!providerId) { setState('error'); return; }
    setState('loading');
    try { setProvider(await fetchProviderProfile(providerId)); setState('ready'); }
    catch (error) { setState(isOfflineError(error) ? 'offline' : 'error'); }
  }, [providerId]);
  useEffect(() => { void load(); }, [load]);

  const isBookable = providerType === 'vet' || providerType === 'groomer';
  const footer = state === 'ready' && provider ? (
    <StickyCta
      label={t(isBookable ? 'providerFoundation.book' : 'providerFoundation.browse')}
      onPress={() => {
        if (isBookable) void requireAuth({ action: 'BOOKING', returnTo: providerType === 'vet' ? '/vet' : '/groom' });
        else router.push({ pathname: '/commerce/[slug]', params: { slug: provider.providerId } } as never);
      }}
    />
  ) : undefined;

  return (
    <ScreenShell scroll={false} header={<AppBar title={provider?.name ?? t('routes.provider')} />} footer={footer} testID="provider-profile-screen">
      {state === 'loading' ? <StateView kind="loading" title={t('states.loading')} /> : null}
      {state === 'offline' || state === 'error' ? <StateView kind={state} title={t(state === 'offline' ? 'states.offline' : 'states.error')} message={t(state === 'offline' ? 'states.offlineMessage' : 'states.errorMessage')} actionLabel={t('states.retry')} onAction={() => void load()} /> : null}
      {state === 'ready' && provider ? <EntityCard title={provider.name} subtitle={provider.description || t('providerFoundation.descriptionFallback')} meta={t('providerFoundation.meta', { rating: provider.ratingAvg.toFixed(1), count: provider.ratingCount, city: provider.city })} icon={isBookable ? 'medical' : 'store'} badge={provider.status} /> : null}
    </ScreenShell>
  );
}
