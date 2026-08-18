import {
  APPOINTMENT_DISPLAY_TIME_ZONE,
  fetchAppointmentServices,
  fetchAvailableAppointmentSlots,
} from '../appointment-booking';

const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const providerId = '22222222-2222-4222-8222-222222222222';
const serviceId = '11111111-1111-4111-8111-111111111111';

function service(overrides: Record<string, unknown> = {}) {
  return {
    serviceId,
    outletId: providerId,
    capability: 'GROOMING',
    name: 'Full Spa',
    description: 'Bath and trim',
    durationMinutes: 60,
    pricePaise: 129900,
    currency: 'INR',
    ...overrides,
  };
}

describe('P10 grooming service and slot public contracts', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('keeps services scoped to the selected provider and capability with paise/currency authority', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      items: [service()], page: 0, pageSize: 100, hasNext: false,
    }));

    const services = await fetchAppointmentServices({ providerId, capability: 'GROOMING' });

    expect(mockedFetch.mock.calls[0][0]).toContain(`outletId=${providerId}`);
    expect(mockedFetch.mock.calls[0][0]).toContain('capability=GROOMING');
    expect(services).toEqual([expect.objectContaining({
      id: serviceId,
      providerId,
      durationMinutes: 60,
      pricePaise: 129900,
      price: 1299,
      currency: 'INR',
    })]);
  });

  it('rejects cross-provider leakage and malformed money instead of inventing zero price', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      items: [service({ outletId: '33333333-3333-4333-8333-333333333333' })],
      page: 0, pageSize: 100, hasNext: false,
    }));
    await expect(fetchAppointmentServices({ providerId, capability: 'GROOMING' }))
      .rejects.toMatchObject({ name: 'SERVICE_PROVIDER_MISMATCH' });

    mockedFetch.mockResolvedValueOnce(jsonResponse({
      items: [service({ pricePaise: 'not-money' })],
      page: 0, pageSize: 100, hasNext: false,
    }));
    await expect(fetchAppointmentServices({ providerId, capability: 'GROOMING' }))
      .rejects.toMatchObject({ name: 'SERVICE_PRICE_INVALID' });
  });

  it('deduplicates identical service ids and follows bounded pagination', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [service()], page: 0, pageSize: 100, hasNext: true,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [service()], page: 1, pageSize: 100, hasNext: false,
      }));

    const services = await fetchAppointmentServices({ providerId, capability: 'GROOMING' });
    expect(services).toHaveLength(1);
    expect(mockedFetch.mock.calls[1][0]).toContain('page=1');
  });

  it('preserves canonical Instant strings and rejects a slot returned for another service', async () => {
    const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [service()], page: 0, pageSize: 100, hasNext: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          slotId: '44444444-4444-4444-8444-444444444444',
          serviceId,
          startsAt,
          endsAt,
        }],
        page: 0, pageSize: 100, hasNext: false,
      }));

    const slots = await fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING');
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      offeringId: serviceId,
      startsAt,
      endsAt,
      pricePaise: 129900,
      currency: 'INR',
    });
    expect(APPOINTMENT_DISPLAY_TIME_ZONE).toBe('Asia/Kolkata');

    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [service()], page: 0, pageSize: 100, hasNext: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          slotId: '55555555-5555-4555-8555-555555555555',
          serviceId: '66666666-6666-4666-8666-666666666666',
          startsAt,
          endsAt,
        }],
        page: 0, pageSize: 100, hasNext: false,
      }));
    await expect(fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING'))
      .rejects.toMatchObject({ name: 'SLOT_SERVICE_MISMATCH' });
  });

  it('drops a slot that becomes past in flight and reports removed services as unavailable', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const pastEnd = new Date(Date.now() + 60_000).toISOString();
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [service()], page: 0, pageSize: 100, hasNext: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          slotId: '77777777-7777-4777-8777-777777777777',
          serviceId,
          startsAt: past,
          endsAt: pastEnd,
        }],
        page: 0, pageSize: 100, hasNext: false,
      }));
    await expect(fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING')).resolves.toEqual([]);

    mockedFetch.mockResolvedValueOnce(jsonResponse({
      items: [], page: 0, pageSize: 100, hasNext: false,
    }));
    await expect(fetchAvailableAppointmentSlots(providerId, serviceId, 'GROOMING'))
      .rejects.toMatchObject({ name: 'SERVICE_NOT_AVAILABLE' });
  });
});
