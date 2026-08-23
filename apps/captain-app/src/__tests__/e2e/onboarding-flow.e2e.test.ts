import {
  fetchOnboardingDraft,
  saveOnboardingDraft,
  submitOnboardingApplication,
} from '../../api/onboarding';
import { fetchCaptainProfile } from '../../api/captain';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { OnboardingDraft } from '../../domain/onboarding';

describe('E2E: Captain Onboarding & Approval Lifecycle Flow', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('e2e-onboarding-captain-token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('executes complete step-by-step onboarding, document verification, submission, immutability check, and approval', async () => {
    // 1. Initial State: Fetch empty/initial draft
    const initialDraft: OnboardingDraft = {
      stepCompleted: 0,
      personal: {
        fullName: '',
        dob: '',
        emergencyContact: '',
        address: '',
        city: '',
        pincode: '',
      },
      identity: {
        identityType: 'AADHAAR',
        identityNumber: '',
        drivingLicenseNumber: '',
        licenseExpiry: '',
        licenseUploaded: false,
      },
      vehicle: {
        vehicleType: 'BIKE',
        registrationNumber: '',
        model: '',
        colour: '',
        rcUploaded: false,
      },
      bank: {
        accountHolder: '',
        accountNumber: '',
        ifsc: '',
        bankName: '',
      },
      consent: {
        captainAgreementAccepted: false,
        privacyPolicyAccepted: false,
        locationUsageAccepted: false,
        safetyPolicyAccepted: false,
        settlementTermsAccepted: false,
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => initialDraft,
    });

    const step0Draft = await fetchOnboardingDraft();
    expect(step0Draft.stepCompleted).toBe(0);

    // 2. Step 1: Populate Personal Details & Consents
    const step1Draft: OnboardingDraft = {
      ...initialDraft,
      stepCompleted: 1,
      personal: {
        fullName: 'Vikram Seth',
        dob: '1995-05-12',
        emergencyContact: '+919811223344',
        address: '42 MG Road',
        city: 'Bengaluru',
        pincode: '560001',
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => step1Draft,
    });

    const savedStep1 = await saveOnboardingDraft(step1Draft);
    expect(savedStep1.personal?.fullName).toBe('Vikram Seth');
    expect(savedStep1.stepCompleted).toBe(1);

    // 3. Step 2 & 3: Populate Identity, Vehicle, & Bank details
    const completedDraft: OnboardingDraft = {
      ...step1Draft,
      stepCompleted: 5,
      identity: {
        identityType: 'AADHAAR',
        identityNumber: '123456789012',
        drivingLicenseNumber: 'DL-0420110012345',
        licenseExpiry: '2035-12-31',
        licenseUploaded: true,
      },
      vehicle: {
        vehicleType: 'BIKE',
        registrationNumber: 'KA-01-AB-1234',
        model: 'Ather 450X',
        colour: 'White',
        rcUploaded: true,
      },
      bank: {
        accountHolder: 'Vikram Seth',
        accountNumber: '918273645019',
        ifsc: 'HDFC0001234',
        bankName: 'HDFC Bank',
      },
      consent: {
        captainAgreementAccepted: true,
        privacyPolicyAccepted: true,
        locationUsageAccepted: true,
        safetyPolicyAccepted: true,
        settlementTermsAccepted: true,
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => completedDraft,
    });

    const savedComplete = await saveOnboardingDraft(completedDraft);
    expect(savedComplete.identity?.identityNumber).toBe('123456789012');
    expect(savedComplete.vehicle?.vehicleType).toBe('BIKE');
    expect(savedComplete.consent?.captainAgreementAccepted).toBe(true);

    // 4. Submit Onboarding Application
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        status: 'SUBMITTED',
      }),
    });

    const submission = await submitOnboardingApplication();
    expect(submission.success).toBe(true);
    expect(submission.status).toBe('SUBMITTED');

    // 5. Immutability Enforcement: Attempting to modify submitted draft returns 400 Bad Request
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        code: 'ONBOARDING_ALREADY_SUBMITTED',
        message: 'Cannot modify application after submission',
      }),
    });

    await expect(saveOnboardingDraft(completedDraft)).rejects.toThrow();

    // 6. Admin Approval Event: Profile transitions to ACTIVE and APPROVED
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: 'cpt-onboarding-001',
        name: 'Vikram Seth',
        mobile: '+919876543210',
        status: 'ACTIVE',
        approved: true,
        online: false,
        busy: false,
      }),
    });

    const activeProfile = await fetchCaptainProfile();
    expect(activeProfile.approved).toBe(true);
    expect(activeProfile.status).toBe('ACTIVE');
  });
});
