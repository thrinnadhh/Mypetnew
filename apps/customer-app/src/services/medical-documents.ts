import { apiErrorFromResponse } from '@/contracts/api-error';
import { apiClient, StaleAuthResponseError } from '@/services/api-client';
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

function assertCurrentAuthEpoch(epoch: number): void {
  if (apiClient.getAuthEpoch() !== epoch) throw new StaleAuthResponseError();
}

async function authenticated<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
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
  const epoch = apiClient.getAuthEpoch();
  const response = await fetch(reservation.uploadUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    body,
  });
  assertCurrentAuthEpoch(epoch);
  if (!response.ok) throw await apiErrorFromResponse(response);
  const document = (await response.json()) as MedicalDocument;
  assertCurrentAuthEpoch(epoch);
  return document;
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
  if (!isSafeHttpsUrl(link.url)) throw new Error('Medical document link is invalid.');
  return link.url;
}
