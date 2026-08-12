import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';

import { ProviderProfileTemplate } from '@/components/commerce/ProviderProfileTemplate';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import type { ShopProfileData } from '@/services/catalog-data';
import { fetchShopProfile } from '@/services/customer-catalog';
import { isOfflineError } from '@/services/customer-profile';

type LoadState = 'loading' | 'ready' | 'offline' | 'error';

export default function ShopProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [shop, setShop] = useState<ShopProfileData | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const load = useCallback(async () => {
    if (!id) {
      setState('error');
      return;
    }

    setState('loading');
    try {
      setShop(await fetchShopProfile(id));
      setState('ready');
    } catch (error) {
      setShop(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'loading') {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Pet store" />}>
        <StateView kind="loading" title="Loading live store catalog" />
      </ScreenShell>
    );
  }

  if (state === 'offline' || state === 'error' || !shop) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Pet store" />}>
        <StateView
          kind={state === 'offline' ? 'offline' : 'error'}
          title={state === 'offline' ? 'You are offline' : 'Store unavailable'}
          message={state === 'offline' ? 'Reconnect to load current store inventory.' : 'This store could not be loaded.'}
          actionLabel="Retry"
          onAction={() => void load()}
        />
      </ScreenShell>
    );
  }

  return <ProviderProfileTemplate shop={shop} />;
}
