import {
  fetchPendingOffers,
  markJobDelivered,
  markJobPickedUp,
  respondToOffer,
} from '../../api/dispatch';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';

describe('Level 2: Dispatch API Contract Tests', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('contract-valid-jwt');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('GET /api/v1/captain/dispatch/offers contract', async () => {
    let capturedUrl = '';
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [
          {
            offerId: 'off-01',
            jobId: 'job-01',
            expiresAt: '2026-08-23T12:00:30Z',
          },
        ],
      });
    });

    const offers = await fetchPendingOffers();
    expect(offers).toHaveLength(1);
    expect(offers[0].offerId).toBe('off-01');
    expect(capturedUrl).toContain('/api/v1/captain/dispatch/offers');
    expect(capturedOpts.headers.Authorization).toBe('Bearer contract-valid-jwt');
  });

  it('POST /api/v1/captain/dispatch/offers/:offerId/respond contract (ACCEPT & REJECT)', async () => {
    let capturedUrl = '';
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          accepted: true,
          jobId: 'job-01',
          orderId: 'ord-01',
          outletId: 'out-01',
          outletName: 'Pet Care Store',
          deliveryAddress: {
            addressId: 'addr-01',
            recipientName: 'Rahul Sharma',
            phoneNumber: '+919876543210',
            line1: '123 MG Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
        }),
      });
    });

    const assignment = await respondToOffer('off-01', 'ACCEPT', 'idemp-resp-1');
    expect(assignment.accepted).toBe(true);
    expect(assignment.jobId).toBe('job-01');
    expect(capturedUrl).toContain('/api/v1/captain/dispatch/offers/off-01/respond');
    expect(capturedOpts.method).toBe('POST');
    expect(JSON.parse(capturedOpts.body)).toEqual({ action: 'ACCEPT' });
    expect(capturedOpts.headers['Idempotency-Key']).toBe('idemp-resp-1');
  });

  it('POST /api/v1/captain/dispatch/:jobId/picked-up contract', async () => {
    let capturedUrl = '';
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'job-01',
          orderId: 'ord-01',
          outletId: 'out-01',
          originLatitude: 12.9716,
          originLongitude: 77.5946,
          status: 'PICKED_UP',
          pickedUpAt: '2026-08-23T12:05:00Z',
        }),
      });
    });

    const job = await markJobPickedUp('job-01', 'idemp-pickup-999', { type: 'PIN', pinCode: '1234' });
    expect(job.status).toBe('PICKED_UP');
    expect(capturedUrl).toContain('/api/v1/captain/dispatch/job-01/picked-up');
    expect(capturedOpts.method).toBe('POST');
    expect(capturedOpts.headers['Idempotency-Key']).toBe('idemp-pickup-999');
    expect(JSON.parse(capturedOpts.body)).toEqual({
      proof: {
        type: 'PIN',
        pinCode: '1234',
        capturedAt: expect.any(String),
      },
    });
  });

  it('POST /api/v1/captain/dispatch/:jobId/delivered contract', async () => {
    let capturedUrl = '';
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'job-01',
          orderId: 'ord-01',
          outletId: 'out-01',
          originLatitude: 12.9716,
          originLongitude: 77.5946,
          status: 'DELIVERED',
          deliveredAt: '2026-08-23T12:20:00Z',
        }),
      });
    });

    const job = await markJobDelivered('job-01', 'idemp-deliv-888', { type: 'PIN', pinCode: '5678' });
    expect(job.status).toBe('DELIVERED');
    expect(capturedUrl).toContain('/api/v1/captain/dispatch/job-01/delivered');
    expect(capturedOpts.method).toBe('POST');
    expect(capturedOpts.headers['Idempotency-Key']).toBe('idemp-deliv-888');
    expect(JSON.parse(capturedOpts.body)).toEqual({
      proof: {
        type: 'PIN',
        pinCode: '5678',
        capturedAt: expect.any(String),
      },
    });
  });
});
