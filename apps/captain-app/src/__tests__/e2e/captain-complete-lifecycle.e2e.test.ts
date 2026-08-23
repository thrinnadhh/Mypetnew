import { requestCaptainOtp, verifyCaptainOtp } from '../../api/auth';
import { updateCaptainAvailability } from '../../api/availability';
import { fetchCaptainProfile } from '../../api/captain';
import {
  fetchDispatchJob,
  fetchPendingOffers,
  respondToOffer,
} from '../../api/dispatch';
import { fetchCaptainEarnings } from '../../api/earnings';
import {
  clearSession,
  getRuntimeAccessToken,
  setRuntimeAccessTokenForTesting,
} from '../../auth/session';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { commandStore } from '../../sync/command-store';
import { formatPaise } from '../../utils/money';

describe('E2E: Captain Complete Operational Lifecycle', () => {
  const mockCaptainId = 'cpt-e2e-1001';
  const mockPhone = '+919876543210';
  const mockChallengeId = 'chal-e2e-888';
  const mockJwt = 'e2e-captain-jwt-token';
  const mockRefreshToken = 'e2e-captain-refresh-token';

  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    await clearSession();
    await commandStore.clear();
    setRuntimeAccessTokenForTesting(null);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('Stage 1 to 6: Full end-to-end operational flow from login to proof-verified delivery and earnings', async () => {
    // -------------------------------------------------------------
    // STAGE 1: Authentication & Session Establishment
    // -------------------------------------------------------------
    // Step 1.1: Request Phone OTP
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        challengeId: mockChallengeId,
        expiresInSeconds: 300,
      }),
    });

    const otpReq = await requestCaptainOtp(mockPhone);
    expect(otpReq.challengeId).toBe(mockChallengeId);

    // Step 1.2: Verify OTP and acquire JWT credentials
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accountId: mockCaptainId,
        accessToken: mockJwt,
        refreshToken: mockRefreshToken,
        accessTokenExpiresAt: '2026-08-23T18:00:00Z',
        refreshTokenExpiresAt: '2026-09-23T18:00:00Z',
        role: 'CAPTAIN',
      }),
    });

    const verifyRes = await verifyCaptainOtp(mockChallengeId, mockPhone, '123456');
    expect(verifyRes.role).toBe('CAPTAIN');
    expect(verifyRes.accessToken).toBe(mockJwt);

    expect(getRuntimeAccessToken()).toBe(mockJwt);

    // Step 1.3: Verify Profile status
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: mockCaptainId,
        name: 'Arjun Das',
        mobile: mockPhone,
        status: 'ACTIVE',
        approved: true,
        online: false,
        busy: false,
      }),
    });

    const profile = await fetchCaptainProfile();
    expect(profile.approved).toBe(true);
    expect(profile.status).toBe('ACTIVE');

    // -------------------------------------------------------------
    // STAGE 2: Presence & GPS Broadcast (Go Online)
    // -------------------------------------------------------------
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: mockCaptainId,
        approved: true,
        online: true,
        busy: false,
        lastLocationAt: '2026-08-23T12:00:00Z',
      }),
    });

    const presence = await updateCaptainAvailability({
      online: true,
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 8,
    });

    expect(presence.online).toBe(true);
    expect(presence.busy).toBe(false);

    // -------------------------------------------------------------
    // STAGE 3: Offer Discovery & Acceptance
    // -------------------------------------------------------------
    const mockOfferId = 'offer-lifecycle-001';
    const mockJobId = 'job-lifecycle-501';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          offerId: mockOfferId,
          jobId: mockJobId,
          expiresAt: new Date(Date.now() + 28000).toISOString(),
          outletName: 'Pet Mart Indiranagar',
          area: 'Indiranagar 100ft Road',
          distanceMeters: 850,
          itemCount: 2,
          estimatedEarningPaise: 9500,
        },
      ],
    });

    const offers = await fetchPendingOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0].offerId).toBe(mockOfferId);
    expect(formatPaise(offers[0].estimatedEarningPaise)).toBe('₹95');

    // Accept Offer
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accepted: true,
        jobId: mockJobId,
        orderId: 'ord-lifecycle-9001',
        outletId: 'out-indiranagar-01',
        outletName: 'Pet Mart Indiranagar',
        deliveryAddress: {
          addressId: 'addr-cust-01',
          recipientName: 'Sneha Patel',
          phoneNumber: '+919123456789',
          line1: '45 Defense Colony, 2nd Main',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
      }),
    });

    const assignment = await respondToOffer(mockOfferId, 'ACCEPT');
    expect(assignment.accepted).toBe(true);
    expect(assignment.jobId).toBe(mockJobId);
    expect(assignment.deliveryAddress?.recipientName).toBe('Sneha Patel');

    // -------------------------------------------------------------
    // STAGE 4: Merchant Pickup with PIN Verification
    // -------------------------------------------------------------
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: mockJobId,
        orderId: 'ord-lifecycle-9001',
        outletId: 'out-indiranagar-01',
        status: 'PICKED_UP',
        assignedCaptainId: mockCaptainId,
        pickedUpAt: '2026-08-23T12:10:00Z',
      }),
    });

    const pickupOutcome = await deliveryRepository.markPickedUp(mockJobId, {
      type: 'PIN',
      pinCode: '4455',
      capturedAt: '2026-08-23T12:10:00Z',
    });

    expect(pickupOutcome.outcome).toBe('ACKNOWLEDGED');
    if (pickupOutcome.outcome === 'ACKNOWLEDGED') {
      expect(pickupOutcome.data.state).toBe('PICKED_UP');
      expect(pickupOutcome.data.pickedUpAt).toBe('2026-08-23T12:10:00Z');
    }

    // -------------------------------------------------------------
    // STAGE 5: Customer Delivery with PIN Verification
    // -------------------------------------------------------------
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: mockJobId,
        orderId: 'ord-lifecycle-9001',
        outletId: 'out-indiranagar-01',
        status: 'DELIVERED',
        assignedCaptainId: mockCaptainId,
        deliveredAt: '2026-08-23T12:25:00Z',
      }),
    });

    const deliverOutcome = await deliveryRepository.markDelivered(mockJobId, {
      type: 'PIN',
      pinCode: '8899',
      capturedAt: '2026-08-23T12:25:00Z',
    });

    expect(deliverOutcome.outcome).toBe('ACKNOWLEDGED');
    if (deliverOutcome.outcome === 'ACKNOWLEDGED') {
      expect(deliverOutcome.data.state).toBe('DELIVERED');
      expect(deliverOutcome.data.deliveredAt).toBe('2026-08-23T12:25:00Z');
    }

    // Verify Server Job Status is Authoritative
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: mockJobId,
        orderId: 'ord-lifecycle-9001',
        outletId: 'out-indiranagar-01',
        outletName: 'Pet Mart Indiranagar',
        status: 'DELIVERED',
        assignedCaptainId: mockCaptainId,
        assignedAt: '2026-08-23T12:02:00Z',
        pickedUpAt: '2026-08-23T12:10:00Z',
        deliveredAt: '2026-08-23T12:25:00Z',
      }),
    });

    const finalJob = await fetchDispatchJob(mockJobId);
    expect(finalJob.status).toBe('DELIVERED');

    // -------------------------------------------------------------
    // STAGE 6: Earnings Verification & Clean Logout
    // -------------------------------------------------------------
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        todayPaise: 9500,
        todayDeliveryCount: 1,
        thisWeekPaise: 84000,
        thisMonthPaise: 425000,
        recentEarnings: [],
        settlements: [],
      }),
    });

    const earnings = await fetchCaptainEarnings();
    expect(earnings.todayPaise).toBe(9500);
    expect(formatPaise(earnings.todayPaise)).toBe('₹95');
    expect(earnings.todayDeliveryCount).toBe(1);

    // Logout
    await clearSession();
    expect(getRuntimeAccessToken()).toBeNull();
  });
});
