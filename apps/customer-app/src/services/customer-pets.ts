import { apiErrorFromResponse } from '@/contracts/api-error';
import { appConfig } from '@/utils/app-config';

export interface CustomerPet {
  petId: string;
  name: string;
  species: string;
  breed?: string | null;
  dateOfBirth?: string | null;
}

export interface CreateCustomerPetInput {
  name: string;
  species: string;
  breed?: string | null;
  dateOfBirth?: string | null;
}

const demoPets: CustomerPet[] = [
  {
    petId: 'demo-pet-bruno',
    name: 'Bruno',
    species: 'DOG',
    breed: 'Golden Retriever',
    dateOfBirth: '2024-02-14',
  },
  {
    petId: 'demo-pet-luna',
    name: 'Luna',
    species: 'CAT',
    breed: 'Indian Shorthair',
    dateOfBirth: '2025-01-10',
  },
];

async function request<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function fetchCustomerPets(accessToken: string): Promise<CustomerPet[]> {
  if (appConfig.allowDemoMode) return Promise.resolve(demoPets.map((pet) => ({ ...pet })));
  return request('/api/v1/pets', accessToken);
}

export function createCustomerPet(
  input: CreateCustomerPetInput,
  accessToken: string,
): Promise<CustomerPet> {
  if (appConfig.allowDemoMode) {
    const created: CustomerPet = {
      petId: `demo-pet-${Date.now()}`,
      name: input.name,
      species: input.species,
      breed: input.breed ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
    };
    demoPets.push(created);
    return Promise.resolve({ ...created });
  }
  return request('/api/v1/pets', accessToken, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
