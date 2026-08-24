import { appConfig } from '@/utils/app-config';
import type { LanguageId } from '@/constants/content';
import { apiClient } from './api-client';

export interface VaccinationReminder {
  reminderId: string;
  petId: string;
  vaccineName: string;
  dueDate: string;
  clinicName: string | null;
  enabled: boolean;
}

function retainLegacyTokenParameter(_accessToken?: string | null): void {
  // AuthContext owns the canonical ApiClient token. Keep the argument only for
  // source compatibility while callers stop plumbing access tokens explicitly.
}

export async function fetchLocale(accessToken?: string | null): Promise<LanguageId> {
  if (appConfig.allowDemoMode) return 'en';
  retainLegacyTokenParameter(accessToken);
  try {
    const body = await apiClient.get<{ locale: LanguageId }>('/api/v1/profiles/me/locale');
    return body.locale;
  } catch {
    return 'en';
  }
}

export async function updateLocale(locale: LanguageId, accessToken?: string | null): Promise<void> {
  if (appConfig.allowDemoMode) return;
  retainLegacyTokenParameter(accessToken);
  await apiClient.patch('/api/v1/profiles/me/locale', { locale });
}

export async function fetchVaccinationReminders(accessToken?: string | null): Promise<VaccinationReminder[]> {
  if (appConfig.allowDemoMode) {
    return [
      {
        reminderId: 'vr-1',
        petId: 'pet-1',
        vaccineName: 'DHPP booster',
        dueDate: '2026-08-15',
        clinicName: 'Happy Paws Clinic',
        enabled: true,
      },
      {
        reminderId: 'vr-2',
        petId: 'pet-2',
        vaccineName: 'Rabies',
        dueDate: '2026-12-02',
        clinicName: null,
        enabled: true,
      },
    ];
  }
  retainLegacyTokenParameter(accessToken);
  const rows = await apiClient.get<Array<VaccinationReminder & { reminderId: string }>>('/api/v1/vaccination-reminders');
  return rows.map((row) => ({ ...row, reminderId: String(row.reminderId) }));
}

export async function setVaccinationReminderEnabled(
  reminderId: string,
  enabled: boolean,
  accessToken?: string | null,
): Promise<void> {
  if (appConfig.allowDemoMode) return;
  retainLegacyTokenParameter(accessToken);
  await apiClient.patch(`/api/v1/vaccination-reminders/${reminderId}`, { enabled });
}
