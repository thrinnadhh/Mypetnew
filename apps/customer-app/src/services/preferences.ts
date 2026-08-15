import { appConfig } from '@/utils/app-config';
import type { LanguageId } from '@/constants/content';

export interface VaccinationReminder {
  reminderId: string;
  petId: string;
  vaccineName: string;
  dueDate: string;
  clinicName: string | null;
  enabled: boolean;
}

function jsonHeaders(accessToken?: string | null): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export async function fetchLocale(accessToken?: string | null): Promise<LanguageId> {
  if (appConfig.allowDemoMode) return 'en';
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/profiles/me/locale`, {
    headers: jsonHeaders(accessToken),
  });
  if (!response.ok) return 'en';
  const body = (await response.json()) as { locale: LanguageId };
  return body.locale;
}

export async function updateLocale(locale: LanguageId, accessToken?: string | null): Promise<void> {
  if (appConfig.allowDemoMode) return;
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/profiles/me/locale`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ locale }),
  });
  if (!response.ok) throw new Error('Could not save language preference');
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
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/vaccination-reminders`, {
    headers: jsonHeaders(accessToken),
  });
  if (!response.ok) throw new Error('Could not load vaccination reminders');
  const rows = (await response.json()) as Array<VaccinationReminder & { reminderId: string }>;
  return rows.map((row) => ({ ...row, reminderId: String(row.reminderId) }));
}

export async function setVaccinationReminderEnabled(
  reminderId: string,
  enabled: boolean,
  accessToken?: string | null,
): Promise<void> {
  if (appConfig.allowDemoMode) return;
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/vaccination-reminders/${reminderId}`, {
    method: 'PATCH',
    headers: jsonHeaders(accessToken),
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error('Could not update reminder');
}
