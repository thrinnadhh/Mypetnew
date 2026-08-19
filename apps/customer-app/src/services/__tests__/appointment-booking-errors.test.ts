import {
  fetchAvailableAppointmentSlots,
  holdAppointmentSlot,
} from '../appointment-booking';

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

  it('uses a fresh idempotency attempt when the deterministic replay is already terminal', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    mockedFetch
      .mockResolvedValueOnce(
        jsonResponse({ appointmentId: 'old-appointment', status: 'CANCELLED' }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({ appointmentId: 'new-appointment', status: 'HOLD' }, 201),
      );

    const appointmentId = await holdAppointmentSlot({
      slot: {
        id: 'slot-rebook',
        providerId: 'provider-rebook',
        offeringId: 'service-rebook',
        serviceName: 'Rebookable service',
        startTime: 'Tomorrow',
        endTime: 'Later',
        startsAt: '2026-08-20T10:00:00Z',
        endsAt: '2026-08-20T10:30:00Z',
        price: 500,
      },
      userId: 'customer-rebook',
      petId: 'pet-rebook',
      pincode: '517501',
      accessToken: 'token',
    });

    expect(appointmentId).toBe('new-appointment');
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[0][1]?.headers).toMatchObject({
      'Idempotency-Key': 'appointment-v2-slot-rebook-pet-rebook-517501',
    });
    expect(mockedFetch.mock.calls[1][1]?.headers).toMatchObject({
      'Idempotency-Key': 'appointment-v2-slot-rebook-pet-rebook-517501-retry-loyw3v28',
    });
    expect(mockedFetch.mock.calls[1][1]?.body).toBe(mockedFetch.mock.calls[0][1]?.body);
    expect(JSON.parse(String(mockedFetch.mock.calls[0][1]?.body))).toMatchObject({
      pincode: '517501',
      slotStartsAt: '2026-08-20T10:00:00Z',
      slotEndsAt: '2026-08-20T10:30:00Z',
    });

    nowSpy.mockRestore();
  });

  it('rejects malformed service PIN before issuing a hold request', async () => {
    await expect(holdAppointmentSlot({
      slot: {
        id: 'slot-invalid-pin',
        providerId: 'provider-invalid-pin',
        offeringId: 'service-invalid-pin',
        serviceName: 'Service',
        startTime: 'Tomorrow',
        endTime: 'Later',
        startsAt: '2026-08-20T10:00:00Z',
        endsAt: '2026-08-20T10:30:00Z',
        price: 500,
      },
      userId: 'customer',
      petId: 'pet',
      pincode: '012345',
      accessToken: 'token',
    })).rejects.toMatchObject({ name: 'PIN_CODE_INVALID' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('rejects a hold without canonical slot timestamps before issuing the mutation', async () => {
    await expect(holdAppointmentSlot({
      slot: {
        id: 'slot-no-time',
        providerId: 'provider-no-time',
        offeringId: 'service-no-time',
        serviceName: 'Service',
        startTime: 'Tomorrow',
        endTime: 'Later',
        price: 500,
      },
      userId: 'customer',
      petId: 'pet',
      pincode: '517501',
      accessToken: 'token',
    })).rejects.toMatchObject({ name: 'SLOT_TIME_INVALID' });
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
