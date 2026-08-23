import {
  fetchPendingOffers,
  markJobDelivered,
  markJobPickedUp,
  respondToOffer,
} from '../../api/dispatch';
import { updateCaptainAvailability } from '../../api/availability';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { getOrCreateIdempotencyKey } from '../../utils/idempotency';
import { formatPaise } from '../../utils/money';

describe('Autonomous End-to-End Delivery Lifecycle Test', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('e2e-valid-jwt-token');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('Stage 1: Captain goes online and broadcasts GPS location', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: 'captain-01',
        approved: true,
        online: true,
        busy: false,
        lastLocationAt: '2026-08-23T12:00:00Z',
      }),
    });

    const state = await updateCaptainAvailability({
      online: true,
      latitude: 13.6288,
      longitude: 79.4192,
    });

    expect(state.online).toBe(true);
    expect(state.approved).toBe(true);
    expect(state.busy).toBe(false);
  });

  it('Stage 2: Captain polls and receives nearby dispatch order offer', async () => {
    const mockOffer = {
      offerId: 'offer-e2e-101',
      jobId: 'job-e2e-501',
      expiresAt: new Date(Date.now() + 30000).toISOString(),
      outletName: 'Pet Care Store',
      area: 'Koramangala',
      distanceMeters: 1200,
      itemCount: 3,
      estimatedEarningPaise: 7500,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [mockOffer],
    });

    const offers = await fetchPendingOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0].offerId).toBe('offer-e2e-101');
    expect(offers[0].estimatedEarningPaise).toBe(7500);
    expect(formatPaise(offers[0].estimatedEarningPaise)).toBe('₹75');
  });

  it('Stage 3: Captain accepts delivery offer and locks assignment', async () => {
    const mockAssignment = {
      accepted: true,
      jobId: 'job-e2e-501',
      orderId: 'order-e2e-901',
      outletId: 'outlet-01',
      outletName: 'Pet Care Store',
      deliveryAddress: {
        addressId: 'addr-01',
        recipientName: 'Rahul Sharma',
        phoneNumber: '+919876543210',
        line1: '123 Koramangala 4th Block',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560034',
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockAssignment,
    });

    const assignment = await respondToOffer('offer-e2e-101', 'ACCEPT');
    expect(assignment.accepted).toBe(true);
    expect(assignment.jobId).toBe('job-e2e-501');
    expect(assignment.deliveryAddress?.recipientName).toBe('Rahul Sharma');
  });

  it('Stage 4: Captain arrives at store and verifies pickup with idempotency', async () => {
    const pickupKey = getOrCreateIdempotencyKey('dispatch:pickup:job-e2e-501');
    expect(pickupKey).toBeDefined();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-e2e-501',
        orderId: 'order-e2e-901',
        outletId: 'outlet-01',
        originLatitude: 13.6288,
        originLongitude: 79.4192,
        status: 'PICKED_UP',
        assignedCaptainId: 'captain-01',
        pickedUpAt: '2026-08-23T12:05:00Z',
      }),
    });

    const pickupRes = await markJobPickedUp('job-e2e-501', pickupKey);
    expect(pickupRes.status).toBe('PICKED_UP');
    expect(pickupRes.pickedUpAt).toBeDefined();

    // Verify idempotency header was passed
    const lastCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(lastCall[1].headers['Idempotency-Key']).toBe(pickupKey);
  });

  it('Stage 5: Captain navigates to customer and completes delivery with idempotency', async () => {
    const deliveryKey = getOrCreateIdempotencyKey('dispatch:delivered:job-e2e-501');
    expect(deliveryKey).toBeDefined();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-e2e-501',
        orderId: 'order-e2e-901',
        outletId: 'outlet-01',
        originLatitude: 13.6288,
        originLongitude: 79.4192,
        status: 'DELIVERED',
        assignedCaptainId: 'captain-01',
        deliveredAt: '2026-08-23T12:20:00Z',
      }),
    });

    const deliveryRes = await markJobDelivered('job-e2e-501', deliveryKey);
    expect(deliveryRes.status).toBe('DELIVERED');
    expect(deliveryRes.deliveredAt).toBeDefined();

    // Verify idempotency header was passed
    const lastCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(lastCall[1].headers['Idempotency-Key']).toBe(deliveryKey);
  });
});
