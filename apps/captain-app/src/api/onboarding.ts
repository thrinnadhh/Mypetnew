import { supabase } from '../utils/supabase';
import { captainApiFetch, handleApiResponse } from './client';

export interface OnboardingPersonalDetails {
  fullName: string;
  dob: string;
  emergencyContact: string;
  address: string;
  city: string;
  pincode: string;
}

export interface OnboardingIdentityDetails {
  identityType: 'AADHAAR' | 'PAN' | 'PASSPORT';
  identityNumber: string;
  drivingLicenseNumber: string;
  licenseExpiry: string;
  licenseUploaded: boolean;
}

export interface OnboardingVehicleDetails {
  vehicleType: 'BIKE' | 'SCOOTER';
  registrationNumber: string;
  model: string;
  colour: string;
  rcUploaded: boolean;
}

export interface OnboardingBankDetails {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

export interface OnboardingConsentDetails {
  captainAgreementAccepted: boolean;
  privacyPolicyAccepted: boolean;
  locationUsageAccepted: boolean;
  safetyPolicyAccepted: boolean;
  settlementTermsAccepted: boolean;
}

export interface OnboardingDraft {
  personal?: Partial<OnboardingPersonalDetails>;
  identity?: Partial<OnboardingIdentityDetails>;
  vehicle?: Partial<OnboardingVehicleDetails>;
  bank?: Partial<OnboardingBankDetails>;
  consent?: Partial<OnboardingConsentDetails>;
  stepCompleted: number;
}

let inMemoryDraft: OnboardingDraft = {
  stepCompleted: 0,
};

export async function fetchOnboardingDraft(): Promise<OnboardingDraft> {
  try {
    const response = await captainApiFetch('/api/v1/captain/onboarding/draft', { timeoutMs: 3000 });
    if (response.ok) {
      return await handleApiResponse<OnboardingDraft>(response);
    }
  } catch {
    // Attempt Supabase fetch
    try {
      const { data } = await supabase
        .from('captain_onboarding')
        .select('*')
        .eq('captain_id', 'captain-sandbox-01')
        .single();

      if (data) {
        return {
          personal: {
            fullName: data.full_name,
            dob: data.dob,
            address: data.address,
            city: data.city,
            pincode: data.pincode,
          },
          identity: {
            identityType: data.identity_type,
            identityNumber: data.identity_number,
            drivingLicenseNumber: data.driving_license_number,
            licenseExpiry: data.license_expiry,
            licenseUploaded: data.license_uploaded,
          },
          vehicle: {
            vehicleType: data.vehicle_type,
            registrationNumber: data.vehicle_reg_number,
            model: data.vehicle_model,
            colour: data.vehicle_colour,
            rcUploaded: data.rc_uploaded,
          },
          bank: {
            accountHolder: data.bank_account_holder,
            accountNumber: data.bank_account_number,
            ifsc: data.bank_ifsc,
            bankName: data.bank_name,
          },
          stepCompleted: data.step_completed || 0,
        };
      }
    } catch {
      // In-memory fallback
    }
  }
  return inMemoryDraft;
}

export async function saveOnboardingDraft(draft: Partial<OnboardingDraft>): Promise<OnboardingDraft> {
  inMemoryDraft = {
    ...inMemoryDraft,
    ...draft,
  };

  try {
    const response = await captainApiFetch('/api/v1/captain/onboarding/draft', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inMemoryDraft),
      timeoutMs: 3000,
    });
    if (response.ok) {
      return await handleApiResponse<OnboardingDraft>(response);
    }
  } catch {
    // Sync to Supabase
    try {
      await supabase.from('captain_onboarding').upsert({
        captain_id: 'captain-sandbox-01',
        mobile: '+919876543210',
        full_name: inMemoryDraft.personal?.fullName,
        dob: inMemoryDraft.personal?.dob,
        address: inMemoryDraft.personal?.address,
        city: inMemoryDraft.personal?.city,
        pincode: inMemoryDraft.personal?.pincode,
        identity_type: inMemoryDraft.identity?.identityType,
        identity_number: inMemoryDraft.identity?.identityNumber,
        driving_license_number: inMemoryDraft.identity?.drivingLicenseNumber,
        license_expiry: inMemoryDraft.identity?.licenseExpiry,
        license_uploaded: inMemoryDraft.identity?.licenseUploaded,
        vehicle_type: inMemoryDraft.vehicle?.vehicleType,
        vehicle_reg_number: inMemoryDraft.vehicle?.registrationNumber,
        vehicle_model: inMemoryDraft.vehicle?.model,
        vehicle_colour: inMemoryDraft.vehicle?.colour,
        rc_uploaded: inMemoryDraft.vehicle?.rcUploaded,
        bank_account_holder: inMemoryDraft.bank?.accountHolder,
        bank_account_number: inMemoryDraft.bank?.accountNumber,
        bank_ifsc: inMemoryDraft.bank?.ifsc,
        bank_name: inMemoryDraft.bank?.bankName,
        step_completed: inMemoryDraft.stepCompleted,
        status: 'DRAFT',
        updated_at: new Date().toISOString(),
      });
    } catch {
      // Safe fallback
    }
  }
  return inMemoryDraft;
}

export async function submitOnboardingApplication(): Promise<{ success: boolean; status: string }> {
  try {
    const response = await captainApiFetch('/api/v1/captain/onboarding/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 3000,
    });
    if (response.ok) {
      return await handleApiResponse<{ success: boolean; status: string }>(response);
    }
  } catch {
    // Update Supabase status
    try {
      await supabase
        .from('captain_onboarding')
        .update({ status: 'SUBMITTED', updated_at: new Date().toISOString() })
        .eq('captain_id', 'captain-sandbox-01');
    } catch {
      // Safe fallback
    }
  }
  return { success: true, status: 'SUBMITTED' };
}
