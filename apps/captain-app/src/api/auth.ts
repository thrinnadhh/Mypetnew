import { getInstallationDeviceId, storeSession } from '../auth/session';
import { CaptainSessionEnvelope } from '../auth/types';
import { sanitizeIndianMobile } from '../utils/validation';
import { captainApiFetch, handleApiResponse } from './client';

export interface OtpRequestResponse {
  challengeId: string;
  expiresInSeconds?: number;
}

export async function requestCaptainOtp(mobile: string): Promise<OtpRequestResponse> {
  const sanitized = sanitizeIndianMobile(mobile);
  const deviceId = await getInstallationDeviceId();

  const response = await captainApiFetch('/api/v1/auth/otp/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mobile: sanitized,
      purpose: 'LOGIN',
      deviceId,
    }),
    skipAuth: true,
    timeoutMs: 8000,
  });

  return await handleApiResponse<OtpRequestResponse>(response);
}

export async function verifyCaptainOtp(
  challengeId: string,
  mobile: string,
  code: string,
): Promise<CaptainSessionEnvelope> {
  const sanitized = sanitizeIndianMobile(mobile);

  const response = await captainApiFetch('/api/v1/auth/captain/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      challengeId,
      mobile: sanitized,
      purpose: 'LOGIN',
      code: code.trim(),
    }),
    skipAuth: true,
    timeoutMs: 8000,
  });

  const session = await handleApiResponse<CaptainSessionEnvelope>(response);
  await storeSession(session);
  return session;
}

export async function revokeCurrentCaptainSession(): Promise<void> {
  const response = await captainApiFetch('/api/v1/auth/sessions/current', {
    method: 'DELETE',
    timeoutMs: 5_000,
  });
  await handleApiResponse<void>(response);
}
