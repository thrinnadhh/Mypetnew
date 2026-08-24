import { apiClient } from './api-client';

export async function syncCommunicationContact(accessToken: string): Promise<void> {
  // AuthContext owns the canonical ApiClient token. Keep the argument only for
  // compatibility until callers no longer pass access tokens explicitly.
  void accessToken;
  await apiClient.post('/api/v1/notifications/contact/me');
}
