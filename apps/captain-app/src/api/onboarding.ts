import { OnboardingDraft } from '../domain/onboarding';
import { captainApiFetch, handleApiResponse } from './client';

export type { OnboardingDraft };

export async function fetchOnboardingDraft(): Promise<OnboardingDraft> {
  const response = await captainApiFetch('/api/v1/captain/onboarding/draft', { timeoutMs: 8000 });
  return await handleApiResponse<OnboardingDraft>(response);
}

export async function saveOnboardingDraft(draft: Partial<OnboardingDraft>): Promise<OnboardingDraft> {
  const response = await captainApiFetch('/api/v1/captain/onboarding/draft', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    timeoutMs: 8000,
  });
  return await handleApiResponse<OnboardingDraft>(response);
}

export async function submitOnboardingApplication(): Promise<{ success: boolean; status: string }> {
  const response = await captainApiFetch('/api/v1/captain/onboarding/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 8000,
  });
  return await handleApiResponse<{ success: boolean; status: string }>(response);
}
