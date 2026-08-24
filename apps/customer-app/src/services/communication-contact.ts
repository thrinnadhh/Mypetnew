import { ApiError, apiClient } from './api-client';

export async function syncCommunicationContact(accessToken: string): Promise<void> {
  try {
    await apiClient.post(
      '/api/v1/notifications/contact/me',
      undefined,
      undefined,
      { authToken: accessToken, errorFallback: 'Communication contact sync failed' },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      throw new Error(`Communication contact sync failed (${error.status}): ${error.message}`);
    }
    throw error;
  }
}