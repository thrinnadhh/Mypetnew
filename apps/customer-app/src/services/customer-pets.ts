import { apiClient } from '@/services/api-client';
import { appConfig } from '@/utils/app-config';

export type PetSpecies = 'DOG' | 'CAT' | 'OTHER';

export interface CustomerPet {
  petId: string;
  name: string;
  species: PetSpecies;
  breed?: string | null;
  dateOfBirth?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateCustomerPetInput {
  name: string;
  species: PetSpecies;
  breed?: string | null;
  dateOfBirth?: string | null;
}

export interface CustomerPetPage {
  items: CustomerPet[];
  page: number;
  pageSize: number;
  hasNext: boolean;
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

const authHeaders = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

export async function fetchCustomerPetPage(
  accessToken: string,
  page = 0,
  pageSize = 20,
): Promise<CustomerPetPage> {
  if (appConfig.allowDemoMode) {
    const start = page * pageSize;
    const items = demoPets.slice(start, start + pageSize).map((pet) => ({ ...pet }));
    return { items, page, pageSize, hasNext: start + pageSize < demoPets.length };
  }
  return apiClient.get<CustomerPetPage>(
    `/api/v1/customer/pets?page=${page}&pageSize=${pageSize}`,
    authHeaders(accessToken),
  );
}

export async function fetchCustomerPets(accessToken: string): Promise<CustomerPet[]> {
  if (appConfig.allowDemoMode) return (await fetchCustomerPetPage(accessToken, 0, 100)).items;
  const response = await apiClient.get<CustomerPetPage | CustomerPet[]>(
    '/api/v1/customer/pets?page=0&pageSize=100',
    authHeaders(accessToken),
  );
  return Array.isArray(response) ? response : response.items;
}

export async function createCustomerPet(
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
    return { ...created };
  }
  return apiClient.post<CustomerPet>('/api/v1/customer/pets', input, authHeaders(accessToken));
}

export async function updateCustomerPet(
  petId: string,
  input: CreateCustomerPetInput,
  accessToken: string,
): Promise<CustomerPet> {
  if (appConfig.allowDemoMode) {
    const index = demoPets.findIndex((pet) => pet.petId === petId);
    if (index < 0) throw new Error('Pet not found.');
    demoPets[index] = { ...demoPets[index], ...input };
    return { ...demoPets[index] };
  }
  return apiClient.patch<CustomerPet>(
    `/api/v1/customer/pets/${encodeURIComponent(petId)}`,
    input,
    authHeaders(accessToken),
  );
}

export async function deleteCustomerPet(petId: string, accessToken: string): Promise<void> {
  if (appConfig.allowDemoMode) {
    const index = demoPets.findIndex((pet) => pet.petId === petId);
    if (index >= 0) demoPets.splice(index, 1);
    return;
  }
  await apiClient.delete<void>(`/api/v1/customer/pets/${encodeURIComponent(petId)}`, authHeaders(accessToken));
}
