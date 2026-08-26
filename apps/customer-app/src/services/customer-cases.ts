import { apiClient } from '@/services/api-client';
import { assertCapabilityAvailable } from '@/services/backend-capabilities';
import { appConfig } from '@/utils/app-config';
import { isSafeHttpsUrl, isTrustedBearerUploadUrl } from '@/utils/customer-navigation-safety';

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

export async function fetchCustomerCases(accessToken: string): Promise<CustomerCase[]> {
  assertCapabilityAvailable('supportCases');
  return apiClient.get<CustomerCase[]>(
    '/api/v1/orders/customer-cases',
    undefined,
    { authToken: accessToken, errorFallback: 'Could not load support cases' },
  );
}

export async function createCustomerCase(
  orderId: string,
  caseType: CustomerCaseType,
  description: string,
  accessToken: string,
): Promise<CustomerCase> {
  assertCapabilityAvailable('supportCases');
  return apiClient.post<CustomerCase>(
    '/api/v1/orders/customer-cases',
    { orderId, caseType, description },
    undefined,
    { authToken: accessToken, errorFallback: 'Could not create support case' },
  );
}

export async function uploadCustomerCaseEvidence(
  customerCase: CustomerCase,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<CustomerCaseEvidence> {
  assertCapabilityAvailable('supportCases');
  const reservation = await apiClient.post<{ uploadToken: string; uploadUrl: string }>(
    `/api/v1/orders/customer-cases/${customerCase.caseId}/evidence/reservations`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not reserve support evidence upload' },
  );
  if (!isTrustedBearerUploadUrl(reservation.uploadUrl, appConfig.apiBaseUrl)) {
    throw new Error('Support evidence upload destination is invalid.');
  }

  const body = new FormData();
  body.append('uploadToken', reservation.uploadToken);
  body.append('file', {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);

  return apiClient.upload<CustomerCaseEvidence>(reservation.uploadUrl, body, {
    authToken: accessToken,
    errorFallback: 'Could not upload support evidence',
  });
}

export async function getCustomerCaseEvidenceLink(
  caseId: string,
  evidenceId: string,
  accessToken: string,
): Promise<string> {
  assertCapabilityAvailable('supportCases');
  const response = await apiClient.post<{ url: string }>(
    `/api/v1/orders/customer-cases/${caseId}/evidence/${evidenceId}/signed-link`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not create support evidence link' },
  );
  if (!isSafeHttpsUrl(response.url)) throw new Error('Support evidence link is invalid.');
  return response.url;
}
