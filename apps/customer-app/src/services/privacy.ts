import { apiClient } from './api-client';

export type ConsentPurpose =
  | 'LOCATION'
  | 'NOTIFICATIONS'
  | 'MARKETING'
  | 'PERSONALISATION'
  | 'PRODUCT_ANALYTICS'
  | 'RECURRING_ORDER_REMINDERS';

export interface ConsentRecord {
  consentId: string;
  purpose: ConsentPurpose;
  noticeVersion: string;
  grantedAt: string;
  withdrawnAt: string | null;
}

export interface PersonalDataSummary {
  customerId: string;
  mobileE164: string;
  profile: {
    displayName: string | null;
    email: string | null;
    adultEligibilityAttestedAt: string | null;
  };
  activeConsents: ConsentRecord[];
  processingCategories: string[];
  processorCategories: string[];
}

export function loadPrivacySummary(): Promise<PersonalDataSummary> {
  return apiClient.get('/api/v1/privacy/me');
}

export async function updatePrivacyProfile(displayName: string, email: string): Promise<void> {
  await apiClient.patch('/api/v1/privacy/me', { displayName, email });
}

export function grantConsent(purpose: ConsentPurpose): Promise<ConsentRecord> {
  return apiClient.put(`/api/v1/privacy/consents/${purpose}`, {
    noticeVersion: 'privacy-v1',
    source: 'CUSTOMER_APP',
  });
}

export function withdrawConsent(purpose: ConsentPurpose): Promise<ConsentRecord> {
  return apiClient.delete(`/api/v1/privacy/consents/${purpose}`);
}

export async function createPrivacyRequest(
  requestType: 'ACCESS' | 'CORRECTION' | 'ERASURE' | 'NOMINATION',
  details?: string,
): Promise<void> {
  await apiClient.post('/api/v1/privacy/rights-requests', { requestType, details });
}

export async function createPrivacyGrievance(details: string): Promise<void> {
  await apiClient.post('/api/v1/privacy/grievances', { details });
}

export async function deleteCustomerAccount(): Promise<void> {
  await apiClient.request('/api/v1/privacy/account', {
    method: 'DELETE',
    body: { confirmation: 'DELETE' },
  });
}
