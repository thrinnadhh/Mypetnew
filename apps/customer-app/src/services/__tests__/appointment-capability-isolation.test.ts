import { fetchAvailableAppointmentSlots } from '../appointment-booking';

const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('appointment capability isolation', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('filters grooming slot discovery to grooming services for mixed-capability outlets', async () => {
    mockedFetch
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          serviceId: '11111111-1111-4111-8111-111111111111',
          outletId: '22222222-2222-4222-8222-222222222222',
          capability: 'GROOMING',
          name: 'Full Spa',
          description: 'Bath and trim',
          durationMinutes: 60,
          pricePaise: 129900,
          currency: 'INR',
        }],
        page: 0,
        pageSize: 100,
        hasNext: false,
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{
          slotId: '33333333-3333-4333-8333-333333333333',
          serviceId: '11111111-1111-4111-8111-111111111111',
          startsAt: '2026-08-20T10:00:00Z',
          endsAt: '2026-08-20T11:00:00Z',
        }],
        page: 0,
        pageSize: 100,
        hasNext: false,
      }));

    const slots = await fetchAvailableAppointmentSlots(
      '22222222-2222-4222-8222-222222222222',
      undefined,
      'GROOMING',
    );

    expect(mockedFetch.mock.calls[0][0]).toContain('outletId=22222222-2222-4222-8222-222222222222');
    expect(mockedFetch.mock.calls[0][0]).toContain('capability=GROOMING');
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({
      offeringId: '11111111-1111-4111-8111-111111111111',
      serviceName: 'Full Spa',
      price: 1299,
    });
  });

  it('filters veterinary slot discovery to veterinary services for mixed-capability outlets', async () => {
    mockedFetch.mockResolvedValueOnce(jsonResponse({
      items: [],
      page: 0,
      pageSize: 100,
      hasNext: false,
    }));

    const slots = await fetchAvailableAppointmentSlots(
      '22222222-2222-4222-8222-222222222222',
      undefined,
      'VETERINARY',
    );

    expect(mockedFetch.mock.calls[0][0]).toContain('capability=VETERINARY');
    expect(slots).toEqual([]);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});