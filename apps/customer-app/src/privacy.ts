import type { PublicRuntimeConfig } from '@mypet/api-contracts'

export type ConsentPurpose =
  | 'LOCATION'
  | 'NOTIFICATIONS'
  | 'MARKETING'
  | 'PERSONALISATION'
  | 'PRODUCT_ANALYTICS'
  | 'RECURRING_ORDER_REMINDERS'

export interface ConsentRecord {
  readonly consentId: string
  readonly purpose: ConsentPurpose
  readonly noticeVersion: string
  readonly grantedAt: string
  readonly withdrawnAt?: string
}

export interface PersonalDataSummary {
  readonly customerId: string
  readonly mobileE164: string
  readonly profile: {
    readonly displayName?: string
    readonly email?: string
    readonly adultEligibilityAttestedAt?: string
  }
  readonly activeConsents: readonly ConsentRecord[]
  readonly processingCategories: readonly string[]
  readonly processorCategories: readonly string[]
}

export async function loadPrivacySummary(
  config: PublicRuntimeConfig,
  accessToken: string
): Promise<PersonalDataSummary> {
  return privacyRequest(config, accessToken, '/api/v1/privacy/me')
}

export async function updatePrivacyProfile(
  config: PublicRuntimeConfig,
  accessToken: string,
  displayName: string,
  email: string
): Promise<void> {
  await privacyRequest(config, accessToken, '/api/v1/privacy/me', {
    method: 'PATCH',
    body: JSON.stringify({ displayName, email })
  })
}

export async function grantConsent(
  config: PublicRuntimeConfig,
  accessToken: string,
  purpose: ConsentPurpose
): Promise<ConsentRecord> {
  return privacyRequest(config, accessToken, `/api/v1/privacy/consents/${purpose}`, {
    method: 'PUT',
    body: JSON.stringify({ noticeVersion: 'privacy-v1', source: 'CUSTOMER_APP' })
  })
}

export async function withdrawConsent(
  config: PublicRuntimeConfig,
  accessToken: string,
  purpose: ConsentPurpose
): Promise<ConsentRecord> {
  return privacyRequest(config, accessToken, `/api/v1/privacy/consents/${purpose}`, { method: 'DELETE' })
}

export async function createPrivacyRequest(
  config: PublicRuntimeConfig,
  accessToken: string,
  requestType: 'ACCESS' | 'CORRECTION' | 'ERASURE' | 'NOMINATION',
  details?: string
): Promise<void> {
  await privacyRequest(config, accessToken, '/api/v1/privacy/rights-requests', {
    method: 'POST',
    body: JSON.stringify({ requestType, details })
  })
}

export async function createPrivacyGrievance(
  config: PublicRuntimeConfig,
  accessToken: string,
  details: string
): Promise<void> {
  await privacyRequest(config, accessToken, '/api/v1/privacy/grievances', {
    method: 'POST',
    body: JSON.stringify({ details })
  })
}

export async function deleteCustomerAccount(
  config: PublicRuntimeConfig,
  accessToken: string
): Promise<void> {
  await privacyRequest(config, accessToken, '/api/v1/privacy/account', {
    method: 'DELETE',
    body: JSON.stringify({ confirmation: 'DELETE' })
  })
}

async function privacyRequest<T>(
  config: PublicRuntimeConfig,
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${accessToken}`)
  headers.set('content-type', 'application/json')
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers
  })
  if (!response.ok) throw new Error('Privacy request failed')
  return response.json() as Promise<T>
}
