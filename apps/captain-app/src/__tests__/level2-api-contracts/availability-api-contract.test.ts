import { updateCaptainAvailability } from '../../api/availability';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';

describe('Level 2: Availability API Contract Tests', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('availability-test-token');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('PUT /api/v1/captain/availability contract for going online with GPS coordinates', async () => {
    let capturedUrl = '';
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((url, opts) => {
      capturedUrl = url;
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          captainId: 'captain-101',
          approved: true,
          online: true,
          busy: false,
          lastLocationAt: '2026-08-23T12:00:00Z',
        }),
      });
    });

    const result = await updateCaptainAvailability(
      {
        online: true,
        latitude: 13.6288,
        longitude: 79.4192,
        accuracy: 10,
        capturedAt: '2026-08-23T12:00:00Z',
        heading: 180,
        speed: 5.5,
      },
      'idemp-avail-online',
    );

    expect(result.online).toBe(true);
    expect(result.approved).toBe(true);
    expect(capturedUrl).toContain('/api/v1/captain/availability');
    expect(capturedOpts.method).toBe('PUT');
    expect(capturedOpts.headers['Idempotency-Key']).toBe('idemp-avail-online');

    const body = JSON.parse(capturedOpts.body);
    expect(body.online).toBe(true);
    expect(body.latitude).toBe(13.6288);
    expect(body.longitude).toBe(79.4192);
  });

  it('PUT /api/v1/captain/availability contract for going offline', async () => {
    let capturedOpts: any = {};
    (global.fetch as jest.Mock).mockImplementationOnce((_url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          captainId: 'captain-101',
          approved: true,
          online: false,
          busy: false,
        }),
      });
    });

    const result = await updateCaptainAvailability({ online: false }, 'idemp-avail-offline');
    expect(result.online).toBe(false);
    expect(capturedOpts.method).toBe('PUT');
    expect(capturedOpts.headers['Idempotency-Key']).toBe('idemp-avail-offline');

    const body = JSON.parse(capturedOpts.body);
    expect(body.online).toBe(false);
  });
});
