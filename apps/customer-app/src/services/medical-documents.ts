import { apiClient } from '@/services/api-client';
import { assertCapabilityAvailable } from '@/services/backend-capabilities';
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

export function fetchMedicalDocuments(accessToken: string): Promise<MedicalDocument[]> {
  assertCapabilityAvailable('medicalDocuments');
  return apiClient.get<MedicalDocument[]>(
    '/api/v1/appointments/medical-documents',
    undefined,
    { authToken: accessToken, errorFallback: 'Could not load medical documents' },
  );
}

export async function uploadMedicalDocument(
  appointmentId: string,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<MedicalDocument> {
  assertCapabilityAvailable('medicalDocuments');
  const reservation = await apiClient.post<UploadReservation>(
    `/api/v1/appointments/medical-documents/reservations?appointmentId=${encodeURIComponent(appointmentId)}`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not reserve medical document upload' },
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

  return apiClient.upload<MedicalDocument>(reservation.uploadUrl, body, {
    authToken: accessToken,
    errorFallback: 'Could not upload medical document',
  });
}

export async function getMedicalDocumentLink(
  documentId: string,
  accessToken: string,
  disposition: 'inline' | 'attachment' = 'inline',
): Promise<string> {
  assertCapabilityAvailable('medicalDocuments');
  const link = await apiClient.post<{ url: string }>(
    `/api/v1/appointments/medical-documents/${encodeURIComponent(documentId)}/signed-link?disposition=${disposition}`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not create medical document link' },
  );
  if (!isSafeHttpsUrl(link.url)) throw new Error('Medical document link is invalid.');
  return link.url;
}
