import type { User } from '@supabase/supabase-js';

export interface CustomerProfileState {
  displayName?: string | null;
  verifiedPhone?: string | null;
  email?: string | null;
  hasDeliveryAddress: boolean;
}

export type ProfileRequirement = 'DISPLAY_NAME' | 'VERIFIED_PHONE' | 'DELIVERY_ADDRESS';

export function profileStateFromUser(user: User | null, hasDeliveryAddress = false): CustomerProfileState {
  return {
    displayName: typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name.trim() : null,
    verifiedPhone: user?.phone_confirmed_at ? user.phone : null,
    email: user?.email ?? null,
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
