import { apiClient } from '@/services/api-client';
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

function retainLegacyTokenParameter(_accessToken: string): void {
  // AuthContext owns the canonical ApiClient token. Keep this parameter only for
  // source compatibility with existing screen/service call sites.
}

export function fetchCustomerCases(accessToken: string): Promise<CustomerCase[]> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<CustomerCase[]>('/api/v1/orders/customer-cases');
}

export function createCustomerCase(
  orderId: string,
  caseType: CustomerCaseType,
  description: string,
  accessToken: string,
): Promise<CustomerCase> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.post<CustomerCase>('/api/v1/orders/customer-cases', { orderId, caseType, description });
}

export async function uploadCustomerCaseEvidence(
  customerCase: CustomerCase,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<CustomerCaseEvidence> {
  retainLegacyTokenParameter(accessToken);
  const reservation = await apiClient.post<{ uploadToken: string; uploadUrl: string }>(
    `/api/v1/orders/customer-cases/${customerCase.caseId}/evidence/reservations`,
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

  return apiClient.upload<CustomerCaseEvidence>(reservation.uploadUrl, body);
}

export async function getCustomerCaseEvidenceLink(
  caseId: string,
  evidenceId: string,
  accessToken: string,
): Promise<string> {
  retainLegacyTokenParameter(accessToken);
  const response = await apiClient.post<{ url: string }>(
    `/api/v1/orders/customer-cases/${caseId}/evidence/${evidenceId}/signed-link`,
  );
  if (!isSafeHttpsUrl(response.url)) throw new Error('Support evidence link is invalid.');
  return response.url;
}
