// Central registry of Customer capabilities whose backend routes do not exist yet.
// Evidence: backend/src/main/kotlin/in/mypetnew/application/web ships no customer
// medical-document, support-case, chat, content, vaccination-reminder or locale
// controllers (only VerificationDocumentController.kt, purpose PROVIDER_VERIFICATION),
// and docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md 2.6.3/2.6.4 mark the
// medical/support routes DEFERRED under DD-012 private Supabase storage.
// Release builds always fail closed. Development builds may force a capability for
// local work with EXPO_PUBLIC_ENABLE_* (same __DEV__ pattern as allowDemoMode).

export type BackendCapabilityId =
  | 'medicalDocuments'
  | 'supportCases'
  | 'chat'
  | 'contentEngagement'
  | 'vaccinationReminders'
  | 'localeSync';

interface BackendCapabilityEntry {
  readonly id: BackendCapabilityId;
  readonly available: boolean;
  readonly envOverride: string;
}

const isTruthy = (value: string | undefined) => value === 'true' || value === '1';

export const BACKEND_CAPABILITIES: Readonly<Record<BackendCapabilityId, BackendCapabilityEntry>> = {
  // No customer listing/reservation/upload/signed-link routes; matrix 2.6.3 DEFERRED, DD-012 store is merchant verification only.
  medicalDocuments: { id: 'medicalDocuments', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_MEDICAL_DOCUMENTS' },
  // No /api/v1/orders/customer-cases controller; matrix 2.6.4 DEFERRED.
  supportCases: { id: 'supportCases', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_SUPPORT_CASES' },
  // No conversation/message/attachment routes in the backend gateway.
  chat: { id: 'chat', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_CHAT' },
  // No banners/guides/likes routes; home degrades to static defaults.
  contentEngagement: { id: 'contentEngagement', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_CONTENT_ENGAGEMENT' },
  // No /api/v1/vaccination-reminders route; reminders stay local-only.
  vaccinationReminders: { id: 'vaccinationReminders', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_VACCINATION_REMINDERS' },
  // No /api/v1/profiles/me/locale route; locale stays device-local.
  localeSync: { id: 'localeSync', available: false, envOverride: 'EXPO_PUBLIC_ENABLE_LOCALE_SYNC' },
};

export class CapabilityUnavailableError extends Error {
  readonly capabilityId: BackendCapabilityId;

  constructor(capabilityId: BackendCapabilityId, message?: string) {
    super(message ?? `Backend capability '${capabilityId}' is not available in this build.`);
    this.name = 'CapabilityUnavailableError';
    this.capabilityId = capabilityId;
  }
}

export function isCapabilityAvailable(id: BackendCapabilityId): boolean {
  const entry = BACKEND_CAPABILITIES[id];
  return entry.available || (__DEV__ && isTruthy(process.env[entry.envOverride]));
}

export function assertCapabilityAvailable(id: BackendCapabilityId): void {
  if (!isCapabilityAvailable(id)) throw new CapabilityUnavailableError(id);
}
