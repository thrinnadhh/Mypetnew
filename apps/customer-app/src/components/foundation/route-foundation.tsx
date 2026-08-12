import { useRouter } from 'expo-router';
import React from 'react';

import type { AppIconName } from '@/components/app-icon';
import { AppBar, EntityCard, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { useTranslation } from '@/i18n';

export type FoundationKind = 'commerce' | 'provider' | 'health' | 'grooming' | 'vet' | 'guides' | 'cart' | 'appointments' | 'details';
const icons: Record<FoundationKind, AppIconName> = { commerce: 'store', provider: 'profile', health: 'medical', grooming: 'groom', vet: 'medical', guides: 'shield', cart: 'cart', appointments: 'calendar', details: 'sparkle' };

export function RouteFoundation({ kind }: { kind: FoundationKind }) {
  const { t } = useTranslation();
  const router = useRouter();
  const title = t(`routes.${kind}`);
  return (
    <ScreenShell header={<AppBar title={title} />} testID={`${kind}-route-foundation`}>
      <EntityCard title={title} subtitle={t('routes.foundationMessage')} icon={icons[kind]} />
      <StateView kind="empty" title={t('states.empty')} message={t('states.emptyMessage')} actionLabel={t('common.back')} onAction={() => router.back()} />
    </ScreenShell>
  );
}
