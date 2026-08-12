import { appConfig } from '@/utils/app-config';

export async function syncCommunicationContact(accessToken: string): Promise<void> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/notifications/contact/me`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Communication contact sync failed (${response.status}): ${body.slice(0, 300)}`);
  }
}
