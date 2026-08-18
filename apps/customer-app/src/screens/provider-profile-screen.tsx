import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { AppBar, EntityCard, StateView, StickyCta } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { useLocation } from '@/context/LocationContext';
import { useTranslation } from '@/i18n';
import { isOfflineError } from '@/services/customer-profile';
import {
  fetchProviderProfile,
  type ProviderProfile,
  type ProviderProfileKind,
} from '@/services/provider-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

function normalizeKind(value: string | undefined): ProviderProfileKind | null {
  switch (value?.toLowerCase()) {
    case 'store':
    case 'pet_store': return 'store';
    case 'groomer': return 'groomer';
    case 'vet':
    case 'veterinary':
    case 'vet_hospital': return 'vet';
    default: return null;
  }
}

export default function ProviderProfileScreen() {
  const { id, type } = useLocalSearchParams<{ id?: string | string[]; type?: string | string[] }>();
  const providerId = Array.isArray(id) ? id[0] : id;
  const rawProviderType = Array.isArray(type) ? type[0] : type;
  const kind = normalizeKind(rawProviderType);
  const router = useRouter();
  const { t } = useTranslation();
  const { selectedPincode } = useLocation();
  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const requestGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;
    if (!providerId || !kind || !/^[1-9][0-9]{5}$/.test(selectedPincode)) {
      setProvider(null);
      setState('error');
      return;
    }
    setState('loading');
    setProvider(null);
    try {
      const value = await fetchProviderProfile(providerId, { kind, pincode: selectedPincode });
      if (requestGeneration.current !== generation) return;
      setProvider(value);
      setState('ready');
    } catch (error) {
      if (requestGeneration.current !== generation) return;
      setProvider(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [kind, providerId, selectedPincode]);

  useEffect(() => {
    void load();
    return () => {
      requestGeneration.current += 1;
    };
  }, [load]);

  const footer = state === 'ready' && provider && kind ? (
    <StickyCta
      label={t(kind === 'store' ? 'providerFoundation.browse' : 'providerFoundation.book')}
      onPress={() => {
        if (kind === 'store') {
          router.replace(`/shop/${encodeURIComponent(provider.providerId)}` as never);
        } else if (kind === 'groomer') {
          router.replace(`/groomer/${encodeURIComponent(provider.providerId)}` as never);
        } else {
          router.replace(`/vet/${encodeURIComponent(provider.providerId)}` as never);
        }
      }}
    />
  ) : undefined;

  return (
    <ScreenShell scroll={false} header={<AppBar title={provider?.name ?? t('routes.provider')} />} footer={footer} testID="provider-profile-screen">
      {state === 'loading' ? <StateView kind="loading" title={t('states.loading')} /> : null}
      {state === 'offline' || state === 'error' ? (
        <StateView
          kind={state}
          title={t(state === 'offline' ? 'states.offline' : 'states.error')}
          message={state === 'offline'
            ? t('states.offlineMessage')
            : `This provider is not active, does not match this provider type, or does not serve PIN ${selectedPincode || 'the selected service area'}.`}
          actionLabel={t('states.retry')}
          onAction={() => void load()}
        />
      ) : null}
      {state === 'ready' && provider ? (
        <EntityCard
          title={provider.name}
          subtitle={provider.description || t('providerFoundation.descriptionFallback')}
          meta={`Serves PIN ${selectedPincode}`}
          icon={kind === 'store' ? 'store' : 'medical'}
          badge="Active"
        />
      ) : null}
    </ScreenShell>
  );
}
