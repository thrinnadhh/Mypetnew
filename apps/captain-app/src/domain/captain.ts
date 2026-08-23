export type CaptainApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'ONBOARDING';

export type CaptainState =
  | 'UNAUTHENTICATED'
  | 'AUTHENTICATED'
  | 'ONBOARDING_REQUIRED'
  | 'PENDING_APPROVAL'
  | 'APPROVED_OFFLINE'
  | 'APPROVED_ONLINE'
  | 'BUSY'
  | 'SUSPENDED';

export interface VehicleProfile {
  type: 'BIKE' | 'SCOOTER' | 'OTHER';
  model?: string;
  registrationNumber?: string;
  verified: boolean;
}

export interface BankProfile {
  accountHolder?: string;
  accountNumberMasked?: string;
  ifscMasked?: string;
  bankName?: string;
  verified: boolean;
}

export interface CaptainProfile {
  captainId: string;
  mobile: string;
  name?: string;
  status: CaptainApprovalStatus;
  approved: boolean;
  online: boolean;
  busy: boolean;
  rejectionReason?: string | null;
  joiningDate?: string;
  city?: string;
  vehicle?: VehicleProfile;
  bank?: BankProfile;
  lastLocationAt?: string | null;
}

export interface CaptainPresence {
  online: boolean;
  latitude?: number | null;
  longitude?: number | null;
  lastUpdated?: string;
}

export function computeCaptainState(
  isAuthenticated: boolean,
  profile: CaptainProfile | null,
  hasActiveDelivery: boolean,
): CaptainState {
  if (!isAuthenticated || !profile) {
    return 'UNAUTHENTICATED';
  }

  if (profile.status === 'SUSPENDED') {
    return 'SUSPENDED';
  }

  if (profile.status === 'ONBOARDING' || profile.status === 'DRAFT' || (!profile.vehicle && !profile.bank)) {
    return 'ONBOARDING_REQUIRED';
  }

  if (!profile.approved || profile.status === 'PENDING_REVIEW' || profile.status === 'UNDER_REVIEW' || profile.status === 'SUBMITTED') {
    return 'PENDING_APPROVAL';
  }

  if (hasActiveDelivery || profile.busy) {
    return 'BUSY';
  }

  if (profile.online) {
    return 'APPROVED_ONLINE';
  }

  return 'APPROVED_OFFLINE';
}
