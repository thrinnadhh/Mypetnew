import { apiClient } from './api-client';

export async function syncCommunicationContact(accessToken: string): Promise<void> {
  await apiClient.post(
    '/api/v1/notifications/contact/me',
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Communication contact sync failed' },
  );
}