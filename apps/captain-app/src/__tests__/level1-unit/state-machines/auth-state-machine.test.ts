import {
  computeCaptainState,
  CaptainProfile,
  CaptainApprovalStatus,
} from '../../../domain/captain';

describe('Level 1: Auth State Machine Tests', () => {
  const baseProfile: CaptainProfile = {
    captainId: 'captain-uuid-001',
    mobile: '+919876543210',
    name: 'Suresh Kumar',
    status: 'ACTIVE',
    approved: true,
    online: false,
    busy: false,
    vehicle: { type: 'BIKE', model: 'Hero Splendor', verified: true },
    bank: { bankName: 'SBI', verified: true },
  };

  it('evaluates UNAUTHENTICATED when isAuthenticated is false or profile is null', () => {
    expect(computeCaptainState(false, null, false)).toBe('UNAUTHENTICATED');
    expect(computeCaptainState(false, baseProfile, false)).toBe('UNAUTHENTICATED');
    expect(computeCaptainState(true, null, false)).toBe('UNAUTHENTICATED');
  });

  it('evaluates SUSPENDED when profile status is SUSPENDED regardless of online/approved flags', () => {
    const suspendedProfile: CaptainProfile = {
      ...baseProfile,
      status: 'SUSPENDED',
      approved: true,
      online: true,
    };
    expect(computeCaptainState(true, suspendedProfile, false)).toBe('SUSPENDED');
    expect(computeCaptainState(true, suspendedProfile, true)).toBe('SUSPENDED');
  });

  it('evaluates ONBOARDING_REQUIRED when profile is DRAFT, ONBOARDING, or missing vehicle/bank', () => {
    const draftProfile: CaptainProfile = {
      ...baseProfile,
      status: 'DRAFT',
      approved: false,
    };
    expect(computeCaptainState(true, draftProfile, false)).toBe('ONBOARDING_REQUIRED');

    const onboardingProfile: CaptainProfile = {
      ...baseProfile,
      status: 'ONBOARDING',
      approved: false,
    };
    expect(computeCaptainState(true, onboardingProfile, false)).toBe('ONBOARDING_REQUIRED');

    const missingVehicleProfile: CaptainProfile = {
      ...baseProfile,
      vehicle: undefined,
      bank: undefined,
    };
    expect(computeCaptainState(true, missingVehicleProfile, false)).toBe('ONBOARDING_REQUIRED');
  });

  it('evaluates PENDING_APPROVAL when onboarding is submitted / under review but not approved', () => {
    const reviewStatuses: CaptainApprovalStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'PENDING_REVIEW'];
    for (const status of reviewStatuses) {
      const reviewProfile: CaptainProfile = {
        ...baseProfile,
        status,
        approved: false,
      };
      expect(computeCaptainState(true, reviewProfile, false)).toBe('PENDING_APPROVAL');
    }
  });

  it('evaluates APPROVED_OFFLINE when approved and active but offline and not carrying job', () => {
    const offlineProfile: CaptainProfile = {
      ...baseProfile,
      status: 'ACTIVE',
      approved: true,
      online: false,
      busy: false,
    };
    expect(computeCaptainState(true, offlineProfile, false)).toBe('APPROVED_OFFLINE');
  });

  it('evaluates APPROVED_ONLINE when approved, active, online, and not busy', () => {
    const onlineProfile: CaptainProfile = {
      ...baseProfile,
      status: 'ACTIVE',
      approved: true,
      online: true,
      busy: false,
    };
    expect(computeCaptainState(true, onlineProfile, false)).toBe('APPROVED_ONLINE');
  });

  it('evaluates BUSY when carrying active delivery or marked busy', () => {
    const onlineProfile: CaptainProfile = {
      ...baseProfile,
      status: 'ACTIVE',
      approved: true,
      online: true,
      busy: false,
    };
    // Active delivery flag takes precedence over idle online
    expect(computeCaptainState(true, onlineProfile, true)).toBe('BUSY');

    const busyProfile: CaptainProfile = {
      ...baseProfile,
      status: 'ACTIVE',
      approved: true,
      online: true,
      busy: true,
    };
    expect(computeCaptainState(true, busyProfile, false)).toBe('BUSY');
  });
});
