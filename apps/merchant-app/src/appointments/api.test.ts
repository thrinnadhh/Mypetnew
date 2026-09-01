import { merchantApiFetch } from '../auth/session';
import {
  appointmentTargets,
  decideAppointmentRequest,
  fetchMerchantAppointment,
  fetchMerchantAppointments,
  fetchPendingAppointmentRequests,
  transitionMerchantAppointment,
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
  it('loads all appointments or filtered by status and outlet', async () => {
    fetchMock.mockResolvedValue(response(true, { items: [request], page: 0, pageSize: 50, hasNext: false }));

    await expect(fetchMerchantAppointments({ outletId: 'outlet-1', status: 'BOOKED' })).resolves.toEqual({
      items: [request],
      page: 0,
      pageSize: 50,
      hasNext: false,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/appointments?page=0&pageSize=50&status=BOOKED&outletId=outlet-1');
  });

  it('loads single appointment by ID', async () => {
    fetchMock.mockResolvedValue(response(true, request));

    await expect(fetchMerchantAppointment('appointment-1')).resolves.toEqual(request);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/appointments/appointment-1');
  });

  it('loads only canonical BOOKED requests for provider decision', async () => {
    fetchMock.mockResolvedValue(response(true, { items: [request], page: 0, pageSize: 100, hasNext: false }));

    await expect(fetchPendingAppointmentRequests()).resolves.toEqual([request]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/merchant/appointments?page=0&pageSize=100&status=BOOKED');
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

  it.each([
    ['BOOKED', 'CONFIRMED'],
    ['BOOKED', 'REJECTED'],
    ['CONFIRMED', 'CHECKED_IN'],
    ['CHECKED_IN', 'IN_SERVICE'],
    ['IN_SERVICE', 'COMPLETED'],
    ['CONFIRMED', 'NO_SHOW'],
    ['CONFIRMED', 'CANCELLED'],
  ] as const)('transitions %s to %s successfully', async (fromStatus, toStatus) => {
    const fromReq: MerchantAppointmentRequest = { ...request, status: fromStatus };
    fetchMock.mockResolvedValue(response(true, { ...request, status: toStatus }));

    await expect(transitionMerchantAppointment(fromReq, toStatus)).resolves.toMatchObject({ status: toStatus });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/merchant/appointments/appointment-1/status',
      {
        method: 'POST',
        body: JSON.stringify({ outletId: 'outlet-1', status: toStatus }),
      },
    );
  });

  it('rejects invalid client-side transition before making network request', async () => {
    const bookedReq: MerchantAppointmentRequest = { ...request, status: 'BOOKED' };
    await expect(transitionMerchantAppointment(bookedReq, 'COMPLETED')).rejects.toMatchObject({
      name: 'APPOINTMENT_STATE_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces server rejection instead of assuming provider acceptance', async () => {
    fetchMock.mockResolvedValue(response(false, { code: 'APPOINTMENT_STATE_INVALID', message: 'Already decided' }));

    await expect(decideAppointmentRequest(request, 'CONFIRMED')).rejects.toMatchObject({
      name: 'APPOINTMENT_STATE_INVALID',
      message: 'Already decided',
    });
  });

  describe('appointmentTargets', () => {
    it('returns correct targets for each status', () => {
      expect(appointmentTargets({ ...request, status: 'BOOKED' })).toEqual(['CONFIRMED', 'REJECTED', 'CANCELLED', 'NO_SHOW']);
      expect(appointmentTargets({ ...request, status: 'CONFIRMED' })).toEqual(['CHECKED_IN', 'CANCELLED', 'NO_SHOW']);
      expect(appointmentTargets({ ...request, status: 'CHECKED_IN' })).toEqual(['IN_SERVICE']);
      expect(appointmentTargets({ ...request, status: 'IN_SERVICE' })).toEqual(['COMPLETED']);
      expect(appointmentTargets({ ...request, status: 'COMPLETED' })).toEqual([]);
      expect(appointmentTargets({ ...request, status: 'CANCELLED' })).toEqual([]);
      expect(appointmentTargets({ ...request, status: 'REJECTED' })).toEqual([]);
      expect(appointmentTargets({ ...request, status: 'NO_SHOW' })).toEqual([]);
    });
  });
});
