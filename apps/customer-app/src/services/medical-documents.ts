import { apiErrorFromResponse } from '@/contracts/api-error';
import { appConfig } from '@/utils/app-config';

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

async function authenticated<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    },
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return (await response.json()) as T;
}

export function fetchMedicalDocuments(accessToken: string): Promise<MedicalDocument[]> {
  return authenticated('/api/v1/appointments/medical-documents', accessToken);
}

export async function uploadMedicalDocument(
  appointmentId: string,
  asset: { uri: string; name: string; mimeType: string },
  accessToken: string,
): Promise<MedicalDocument> {
  const reservation = await authenticated<UploadReservation>(
    `/api/v1/appointments/medical-documents/reservations?appointmentId=${encodeURIComponent(appointmentId)}`,
    accessToken,
    { method: 'POST' },
  );
  const body = new FormData();
  body.append('uploadToken', reservation.uploadToken);
  body.append('file', {
    uri: asset.uri,
    name: asset.name,
    type: asset.mimeType,
  } as unknown as Blob);
  const response = await fetch(reservation.uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body,
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return (await response.json()) as MedicalDocument;
}

export async function getMedicalDocumentLink(
  documentId: string,
  accessToken: string,
  disposition: 'inline' | 'attachment' = 'inline',
): Promise<string> {
  const link = await authenticated<{ url: string }>(
    `/api/v1/appointments/medical-documents/${encodeURIComponent(documentId)}/signed-link?disposition=${disposition}`,
    accessToken,
    { method: 'POST' },
  );
  return link.url;
}
