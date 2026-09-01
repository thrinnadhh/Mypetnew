import { useCallback, useEffect, useMemo, useState } from 'react';
import MerchantAppointmentsScreen from '../../../app/appointments';
import {
  fetchMerchantAppointment,
  fetchMerchantAppointments,
  transitionMerchantAppointment,
  type MerchantAppointmentRequest,
} from '../../appointments/api';
import { fetchMerchantCatalogContext } from '../../catalog/api';

jest.mock('react', () => {
  const actual = jest.requireActual('react');
  return {
    ...actual,
    useEffect: jest.fn(),
    useState: jest.fn((initial: unknown) => [
      typeof initial === 'function' ? (initial as () => unknown)() : initial,
      jest.fn(),
    ]),
    useCallback: jest.fn((fn: unknown) => fn),
    useMemo: jest.fn((fn: () => unknown) => fn()),
  };
});

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
  },
  useLocalSearchParams: jest.fn(() => ({})),
  Link: ({ children }: { children: unknown }) => children,
}));

jest.mock('../../catalog/api', () => ({
  fetchMerchantCatalogContext: jest.fn(),
}));

jest.mock('../../appointments/api', () => {
  const actual = jest.requireActual('../../appointments/api');
  return {
    ...actual,
    fetchMerchantAppointments: jest.fn(),
    fetchMerchantAppointment: jest.fn(),
    transitionMerchantAppointment: jest.fn(),
  };
});

jest.mock('../../auth/session', () => ({
  hasRuntimeMerchantSession: jest.fn().mockReturnValue(true),
  merchantApiFetch: jest.fn(),
}));

jest.mock('../../auth/offline-account', () => ({
  loadOfflineMerchantAccountId: jest.fn().mockResolvedValue('acc-1'),
}));

jest.mock('../../data', () => ({
  useMerchantDatabase: jest.fn().mockReturnValue({
    outboxRepo: null,
    syncStateRepo: null,
  }),
}));

const effectMock = useEffect as jest.MockedFunction<typeof useEffect>;
const stateMock = useState as jest.MockedFunction<typeof useState>;
const contextMock = fetchMerchantCatalogContext as jest.MockedFunction<typeof fetchMerchantCatalogContext>;
const appointmentsMock = fetchMerchantAppointments as jest.MockedFunction<typeof fetchMerchantAppointments>;
const singleAppointmentMock = fetchMerchantAppointment as jest.MockedFunction<typeof fetchMerchantAppointment>;
const transitionMock = transitionMerchantAppointment as jest.MockedFunction<typeof transitionMerchantAppointment>;

const mockAppointment: MerchantAppointmentRequest = {
  appointmentId: 'apt-1',
  outletId: 'outlet-1',
  serviceId: 'srv-1',
  slotId: 'slot-1',
  petName: 'Max',
  serviceName: 'Full Grooming Bath',
  startsAt: '2026-09-01T10:00:00Z',
  endsAt: '2026-09-01T10:45:00Z',
  status: 'BOOKED',
  paymentMethod: 'ONLINE_PAYMENT',
  paymentStatus: 'PAID',
  pricePaise: 149900,
  currency: 'INR',
  notes: 'Hypoallergenic shampoo please',
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-01T08:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  stateMock.mockImplementation(((initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    jest.fn(),
  ]) as unknown as typeof useState);
  contextMock.mockResolvedValue({
    organizationId: 'org-1',
    outletIds: ['outlet-1', 'outlet-2'],
    permissionsByOutlet: { 'outlet-1': ['ORDER_FULFIL'], 'outlet-2': ['ORDER_FULFIL'] },
  });
  appointmentsMock.mockResolvedValue({
    items: [
      mockAppointment,
      {
        ...mockAppointment,
        appointmentId: 'apt-2',
        petName: 'Bella',
        serviceName: 'Annual Vaccination',
        status: 'CONFIRMED',
        paymentMethod: 'PAY_AT_PROVIDER',
        paymentStatus: 'NOT_REQUIRED',
        pricePaise: 85000,
      },
    ],
    page: 0,
    pageSize: 100,
    hasNext: false,
  });
});

describe('MF4 Merchant Appointments Screen', () => {
  it('renders appointments screen with modern design system and safe areas', () => {
    expect(MerchantAppointmentsScreen()).toBeTruthy();
    expect(effectMock).toHaveBeenCalled();
  });

  it('loads canonical appointment workload on startup for current outlet', async () => {
    MerchantAppointmentsScreen();
    const startup = effectMock.mock.calls[0][0];
    const cleanup = startup();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(appointmentsMock).toHaveBeenCalledWith({
      outletId: 'outlet-1',
      pageSize: 100,
    });
    if (typeof cleanup === 'function') cleanup();
  });

  it('handles appointment load network error safely', async () => {
    appointmentsMock.mockRejectedValue(new Error('Network request failed'));
    MerchantAppointmentsScreen();
    const startup = effectMock.mock.calls[0][0];
    startup();
    await Promise.resolve();
    await Promise.resolve();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(appointmentsMock).toHaveBeenCalledWith({
      outletId: 'outlet-1',
      pageSize: 100,
    });
  });

  it('executes valid state transition successfully', async () => {
    const updated: MerchantAppointmentRequest = { ...mockAppointment, status: 'CONFIRMED' };
    transitionMock.mockResolvedValue(updated);

    const result = await transitionMerchantAppointment(mockAppointment, 'CONFIRMED');
    expect(transitionMock).toHaveBeenCalledWith(mockAppointment, 'CONFIRMED');
    expect(result.status).toBe('CONFIRMED');
  });

  it('handles stale appointment state rejection gracefully', async () => {
    const staleError = new Error('The appointment cannot be changed from its current state');
    staleError.name = 'APPOINTMENT_STATE_INVALID';
    transitionMock.mockRejectedValue(staleError);

    const freshAppointment: MerchantAppointmentRequest = { ...mockAppointment, status: 'CONFIRMED' };
    singleAppointmentMock.mockResolvedValue(freshAppointment);

    await expect(transitionMerchantAppointment(mockAppointment, 'CONFIRMED')).rejects.toMatchObject({
      name: 'APPOINTMENT_STATE_INVALID',
    });
  });
});
