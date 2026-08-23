export type CaptainApprovalStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'PENDING_REVIEW'
  | 'ACTIVE'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'ONBOARDING';

export interface CaptainSessionEnvelope {
  accountId: string;
  accessToken: string;
  refreshToken: string;
  tokenType?: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
  role: string;
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
  vehicle?: {
    type: 'BIKE' | 'SCOOTER' | 'OTHER';
    model?: string;
    registrationNumber?: string;
    verified: boolean;
  };
  bank?: {
    accountHolder?: string;
    accountNumberMasked?: string;
    ifscMasked?: string;
    bankName?: string;
    verified: boolean;
  };
}
