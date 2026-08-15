import { fetchAvailableAppointmentSlots } from '../appointment-booking';

const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('appointment booking API failure handling', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
  });

  it('surfaces availability API failures instead of treating them as an empty slot list', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{
            serviceId: '33333333-3333-4333-8333-333333333333',
            outletId: '44444444-4444-4444-8444-444444444444',
            capability: 'GROOMING',
            name: 'Bath & Brush',
            description: 'Full grooming',
            durationMinutes: 60,
            pricePaise: 90000,
            currency: 'INR',
          }],
          page: 0,
          pageSize: 100,
          hasNext: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ code: 'SERVICE_UNAVAILABLE', message: 'Appointment service is temporarily unavailable.' }, 503),
      );

    await expect(
      fetchAvailableAppointmentSlots('44444444-4444-4444-8444-444444444444'),
    ).rejects.toMatchObject({
      name: 'SERVICE_UNAVAILABLE',
      message: 'Appointment service is temporarily unavailable.',
    });
  });

  it('still returns an empty list when the availability API succeeds with no slots', async () => {
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({
          items: [{
            serviceId: '33333333-3333-4333-8333-333333333333',
            outletId: '44444444-4444-4444-8444-444444444444',
            capability: 'VETERINARY',
            name: 'Vet Consultation',
            durationMinutes: 30,
            pricePaise: 60000,
            currency: 'INR',
          }],
          page: 0,
          pageSize: 100,
          hasNext: false,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [], page: 0, pageSize: 100, hasNext: false }),
      );

    await expect(
      fetchAvailableAppointmentSlots('44444444-4444-4444-8444-444444444444'),
    ).resolves.toEqual([]);
  });
});
