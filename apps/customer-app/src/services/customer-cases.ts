import { apiErrorFromResponse } from '@/contracts/api-error';
import { apiClient, StaleAuthResponseError } from '@/services/api-client';
import { appConfig } from '@/utils/app-config';
import { isSafeHttpsUrl } from '@/utils/customer-navigation-safety';

export type CustomerCaseType =
  | 'MISSING_ITEM'
  | 'DAMAGED_ITEM'
  | 'WRONG_ITEM'
  | 'LATE_DELIVERY'
  | 'PAYMENT_ISSUE'
  | 'OTHER';

export interface CustomerCaseEvidence {
  evidenceId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface CustomerCase {
  caseId: string;
  orderId: string;
  customerId: string;
  caseType: CustomerCaseType;
  description: string;
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
  refundStatus: 'NOT_APPLICABLE' | 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  resolutionNotes?: string | null;
  evidence: CustomerCaseEvidence[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

function assertCurrentAuthEpoch(epoch: number): void {
  if (apiClient.getAuthEpoch() !== epoch) throw new StaleAuthResponseError();
}

async function request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const epoch = apiClient.getAuthEpoch();
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  assertCurrentAuthEpoch(epoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const body = (await response.json()) as T;
  assertCurrentAuthEpoch(epoch);
  return body;
}

export function fetchCustomerCases(accessToken: string): Promise<CustomerCase[]> {
  return request('/api/v1/orders/customer-cases', accessToken);
}

export function createCustomerCase(
  orderId: string,
  caseType: CustomerCaseType,
  description: string,
  accessToken: string,
): Promise<CustomerCase> {
  return request('/api/v1/orders/customer-cases', accessToken, {
    method: 'POST',
    body: JSON.stringify({ orderId, caseType, description }),
  });
}

export async function uploadCustomerCaseEvidence(
  customerCase: CustomerCase,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<CustomerCaseEvidence> {
  const reservation = await request<{ uploadToken: string; uploadUrl: string }>(
    `/api/v1/orders/customer-cases/${customerCase.caseId}/evidence/reservations`,
    accessToken,
    { method: 'POST' },
  );
  if (!isSafeHttpsUrl(reservation.uploadUrl)) {
    throw new Error('Support evidence upload destination is invalid.');
  }
  const body = new FormData();
  body.append('uploadToken', reservation.uploadToken);
  body.append('file', {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);
  const epoch = apiClient.getAuthEpoch();
  const response = await fetch(reservation.uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body,
  });
  assertCurrentAuthEpoch(epoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const evidence = (await response.json()) as CustomerCaseEvidence;
  assertCurrentAuthEpoch(epoch);
  return evidence;
}

export async function getCustomerCaseEvidenceLink(
  caseId: string,
  evidenceId: string,
  accessToken: string,
): Promise<string> {
  const response = await request<{ url: string }>(
    `/api/v1/orders/customer-cases/${caseId}/evidence/${evidenceId}/signed-link`,
    accessToken,
    { method: 'POST' },
  );
  if (!isSafeHttpsUrl(response.url)) throw new Error('Support evidence link is invalid.');
  return response.url;
}