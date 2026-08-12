import { Session } from '@supabase/supabase-js';
import { appConfig } from './app-config';

type ProfileSyncResult = {
  userId: string;
  role: string;
  fullName: string;
  phoneNumber: string;
  avatarUrl?: string | null;
};

export async function syncAuthenticatedProfile(session: Session, fallbackRole: 'CUSTOMER' | 'MERCHANT' | 'CAPTAIN' | 'ADMIN') {
  if (appConfig.allowDemoMode) return null;

  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/profiles/sync`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      'X-User-Role': fallbackRole,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Profile sync failed: ${response.status} ${message}`);
  }

  return (await response.json()) as ProfileSyncResult;
}
