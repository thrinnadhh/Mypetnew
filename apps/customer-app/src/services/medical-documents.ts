import { apiClient } from '@/services/api-client';
import { appConfig } from '@/utils/app-config';
import { isSafeHttpsUrl, isTrustedBearerUploadUrl } from '@/utils/customer-navigation-safety';

export interface MedicalDocument {
  documentId: string;
  appointmentId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
}

interface UploadReservation {
  uploadToken: string;
  uploadUrl: string;
  expiresAt: string;
}

function retainLegacyTokenParameter(_accessToken: string): void {
  // AuthContext owns the canonical ApiClient token. Keep the argument only for
  // source compatibility while existing call sites stop passing access tokens.
}

export function fetchMedicalDocuments(accessToken: string): Promise<MedicalDocument[]> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<MedicalDocument[]>('/api/v1/appointments/medical-documents');
}

export async function uploadMedicalDocument(
  appointmentId: string,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<MedicalDocument> {
  retainLegacyTokenParameter(accessToken);
  const reservation = await apiClient.post<UploadReservation>(
    `/api/v1/appointments/medical-documents/reservations?appointmentId=${encodeURIComponent(appointmentId)}`,
  );
  if (!isTrustedBearerUploadUrl(reservation.uploadUrl, appConfig.apiBaseUrl)) {
    throw new Error('Medical document upload destination is invalid.');
  }

  const body = new FormData();
  body.append('uploadToken', reservation.uploadToken);
  body.append('file', {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);

  return apiClient.upload<MedicalDocument>(reservation.uploadUrl, body);
}

export async function getMedicalDocumentLink(
  documentId: string,
  accessToken: string,
  disposition: 'inline' | 'attachment' = 'inline',
): Promise<string> {
  retainLegacyTokenParameter(accessToken);
  const link = await apiClient.post<{ url: string }>(
    `/api/v1/appointments/medical-documents/${encodeURIComponent(documentId)}/signed-link?disposition=${disposition}`,
  );
  if (!isSafeHttpsUrl(link.url)) throw new Error('Medical document link is invalid.');
  return link.url;
}
