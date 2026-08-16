import { merchantApiFetch } from '../auth/session';
import {
  decideAppointmentRequest,
  fetchPendingAppointmentRequests,
  type MerchantAppointmentRequest,
} from './api';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;

const request: MerchantAppointmentRequest = {
  appointmentId: 'appointment-1',
  outletId: 'outlet-1',
  serviceId: 'service-1',
  slotId: 'slot-1',
  petName: 'Milo',
  serviceName: 'Full Spa',
  startsAt: '2026-08-16T12:00:00Z',
  endsAt: '2026-08-16T13:00:00Z',
  status: 'BOOKED',
  paymentMethod: 'PAY_AT_PROVIDER',
  paymentStatus: 'NOT_REQUIRED',
  pricePaise: 129900,
  currency: 'INR',
  notes: 'Sensitive paws',
  createdAt: '2026-08-16T06:00:00Z',
  updatedAt: '2026-08-16T06:00:00Z',
};

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => fetchMock.mockReset());

describe('merchant appointment confirmation client', () => {
  it('loads only canonical BOOKED requests for provider decision', async () => {
    fetchMock.mockResolvedValue(response(true, { items: [request], page: 0, pageSize: 100, hasNext: false }));

    await expect(fetchPendingAppointmentRequests()).resolves.toEqual([request]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/appointments?status=BOOKED&page=0&pageSize=100');
  });

  it.each(['CONFIRMED', 'REJECTED'] as const)('posts provider %s decision with server outlet scope', async (decision) => {
    fetchMock.mockResolvedValue(response(true, { ...request, status: decision }));

    await expect(decideAppointmentRequest(request, decision)).resolves.toMatchObject({ status: decision });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/appointments/appointment-1/status',
      {
        method: 'POST',
        body: JSON.stringify({ outletId: 'outlet-1', status: decision }),
      },
    );
  });

  it('surfaces server rejection instead of assuming provider acceptance', async () => {
    fetchMock.mockResolvedValue(response(false, { code: 'APPOINTMENT_STATE_INVALID', message: 'Already decided' }));

    await expect(decideAppointmentRequest(request, 'CONFIRMED')).rejects.toMatchObject({
      name: 'APPOINTMENT_STATE_INVALID',
      message: 'Already decided',
    });
  });
});
