import type { CustomerAuthUser } from './types';

export interface CustomerProfileState {
  displayName?: string | null;
  verifiedPhone?: string | null;
  email?: string | null;
  hasDeliveryAddress: boolean;
}

export type ProfileRequirement = 'DISPLAY_NAME' | 'VERIFIED_PHONE' | 'DELIVERY_ADDRESS';

export function profileStateFromUser(user: CustomerAuthUser | null, hasDeliveryAddress = false): CustomerProfileState {
  return {
    displayName: user?.displayName ?? null,
    verifiedPhone: user?.phone ?? null,
    email: null,
    hasDeliveryAddress,
  };
}

export function missingProfileRequirements(state: CustomerProfileState, purpose: 'POST_AUTH' | 'CHECKOUT'): ProfileRequirement[] {
  const missing: ProfileRequirement[] = [];
  if (!state.displayName) missing.push('DISPLAY_NAME');
  if (purpose === 'CHECKOUT') {
    if (!state.verifiedPhone) missing.push('VERIFIED_PHONE');
    if (!state.hasDeliveryAddress) missing.push('DELIVERY_ADDRESS');
  }
  return missing;
}

export function isProfileComplete(state: CustomerProfileState, purpose: 'POST_AUTH' | 'CHECKOUT') {
  return missingProfileRequirements(state, purpose).length === 0;
}
