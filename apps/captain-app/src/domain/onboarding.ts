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
