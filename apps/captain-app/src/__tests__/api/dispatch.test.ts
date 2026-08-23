import {
  fetchPendingOffers,
  markJobDelivered,
  markJobPickedUp,
  respondToOffer,
} from '../../api/dispatch';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';

describe('Dispatch API Client', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('test-token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('fetches pending dispatch offers successfully', async () => {
    const mockOffers = [
      {
        offerId: 'offer-1',
        jobId: 'job-1',
        expiresAt: '2026-08-23T12:00:30Z',
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockOffers,
    });

    const result = await fetchPendingOffers();
    expect(result).toHaveLength(1);
    expect(result[0].offerId).toBe('offer-1');
  });

  it('responds to an offer with ACCEPT action', async () => {
    const mockAssignment = {
      accepted: true,
      jobId: 'job-1',
      orderId: 'order-1',
      outletId: 'outlet-1',
      outletName: 'Happy Pets Store',
      deliveryAddress: {
        addressId: 'addr-1',
        recipientName: 'Rahul Sharma',
        phoneNumber: '+919876543210',
        line1: '123 MG Road',
        line2: 'Apt 4B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockAssignment,
    });

    const result = await respondToOffer('offer-1', 'ACCEPT');
    expect(result.accepted).toBe(true);
    expect(result.jobId).toBe('job-1');
    expect(result.deliveryAddress?.recipientName).toBe('Rahul Sharma');
  });

  it('sends Idempotency-Key header on markJobPickedUp', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-1',
        status: 'PICKED_UP',
        pickedUpAt: '2026-08-23T12:05:00Z',
      }),
    });

    const result = await markJobPickedUp('job-1', 'idemp-key-123');
    expect(result.status).toBe('PICKED_UP');

    const lastCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(lastCall[1].headers['Idempotency-Key']).toBe('idemp-key-123');
  });

  it('sends Idempotency-Key header on markJobDelivered', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'job-1',
        status: 'DELIVERED',
        deliveredAt: '2026-08-23T12:20:00Z',
      }),
    });

    const result = await markJobDelivered('job-1', 'idemp-key-456');
    expect(result.status).toBe('DELIVERED');

    const lastCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(lastCall[1].headers['Idempotency-Key']).toBe('idemp-key-456');
  });
});
