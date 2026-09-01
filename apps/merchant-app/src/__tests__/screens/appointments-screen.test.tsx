import React from 'react';
import { Alert } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import MerchantAppointmentsScreen from '../../../app/appointments';
import {
  fetchMerchantAppointment,
  fetchMerchantAppointments,
  transitionMerchantAppointment,
  type MerchantAppointmentRequest,
} from '../../appointments/api';
import { fetchMerchantCatalogContext } from '../../catalog/api';
import {
  AppointmentCard,
  AppointmentDetailModal,
  BottomNavigation,
  ConfirmationModal,
  MerchantHeader,
} from '../../design';

const mockRouterPush = jest.fn();
const mockSearchParams = jest.fn(() => ({} as { appointmentId?: string }));

jest.mock('expo-router', () => ({
  router: {
    push: mockRouterPush,
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams(),
  Link: ({ children }: { children: React.ReactNode }) => children,
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

const contextMock = fetchMerchantCatalogContext as jest.MockedFunction<typeof fetchMerchantCatalogContext>;
const appointmentsMock = fetchMerchantAppointments as jest.MockedFunction<typeof fetchMerchantAppointments>;
const singleAppointmentMock = fetchMerchantAppointment as jest.MockedFunction<typeof fetchMerchantAppointment>;
const transitionMock = transitionMerchantAppointment as jest.MockedFunction<typeof transitionMerchantAppointment>;

const OUTLET_1 = '00000000-0000-4000-8000-000000000101';
const OUTLET_2 = '00000000-0000-4000-8000-000000000102';
const APPOINTMENT_1 = '00000000-0000-4000-8000-000000000201';
const APPOINTMENT_2 = '00000000-0000-4000-8000-000000000202';

function appointment(
  appointmentId: string,
  outletId = OUTLET_1,
  status: MerchantAppointmentRequest['status'] = 'BOOKED',
): MerchantAppointmentRequest {
  return {
    appointmentId,
    outletId,
    serviceId: '00000000-0000-4000-8000-000000000301',
    slotId: '00000000-0000-4000-8000-000000000401',
    petName: appointmentId === APPOINTMENT_1 ? 'Max' : 'Bella',
    serviceName: status === 'CONFIRMED' ? 'Annual Vaccination' : 'Full Grooming Bath',
    startsAt: '2026-09-01T12:00:00Z',
    endsAt: '2026-09-01T12:45:00Z',
    status,
    paymentMethod: 'PAY_AT_PROVIDER',
    paymentStatus: 'NOT_REQUIRED',
    pricePaise: 149900,
    currency: 'INR',
    notes: 'Handle gently',
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-01T08:00:00Z',
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = [];

async function renderScreen() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<MerchantAppointmentsScreen />);
  });
  mountedRenderers.push(renderer);
  await flush();
  return renderer;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams.mockReturnValue({});
  contextMock.mockResolvedValue({
    organizationId: '00000000-0000-4000-8000-000000000001',
    outletIds: [OUTLET_1, OUTLET_2],
    permissionsByOutlet: {
      [OUTLET_1]: ['ORDER_FULFIL'],
      [OUTLET_2]: ['ORDER_FULFIL'],
    },
  });
  appointmentsMock.mockResolvedValue({
    items: [appointment(APPOINTMENT_1)],
    page: 0,
    pageSize: 50,
    hasNext: false,
  });
  singleAppointmentMock.mockResolvedValue(appointment(APPOINTMENT_2, OUTLET_2, 'CONFIRMED'));
  transitionMock.mockImplementation(async (current, target) => ({ ...current, status: target }));
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => {
    mountedRenderers.splice(0).forEach((renderer) => renderer.unmount());
    await Promise.resolve();
  });
  jest.restoreAllMocks();
});

describe('MF4R Merchant Appointments Screen', () => {
  it('mounts once without a merchant-context reload loop', async () => {
    const renderer = await renderScreen();
    await flush();

    expect(contextMock).toHaveBeenCalledTimes(1);
    expect(appointmentsMock).toHaveBeenCalledTimes(1);
    expect(appointmentsMock).toHaveBeenCalledWith({
      outletId: OUTLET_1,
      page: 0,
      pageSize: 50,
    });
    expect(renderer.root.findByProps({ testID: 'appointments-list' }).props.data).toHaveLength(1);
    expect(renderer.root.findByType(BottomNavigation).props.activeTab).toBe('more');
  });

  it('switches outlet with server-scoped data and never retains the previous outlet list', async () => {
    appointmentsMock.mockImplementation(async (options) => ({
      items: options?.outletId === OUTLET_2
        ? [appointment(APPOINTMENT_2, OUTLET_2, 'CONFIRMED')]
        : [appointment(APPOINTMENT_1, OUTLET_1)],
      page: 0,
      pageSize: 50,
      hasNext: false,
    }));
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByType(MerchantHeader).props.onSelectOutlet(OUTLET_2);
    });
    await flush();

    expect(appointmentsMock).toHaveBeenLastCalledWith({ outletId: OUTLET_2, page: 0, pageSize: 50 });
    const data = renderer.root.findByProps({ testID: 'appointments-list' }).props.data as MerchantAppointmentRequest[];
    expect(data.map((item) => item.appointmentId)).toEqual([APPOINTMENT_2]);
    expect(data.every((item) => item.outletId === OUTLET_2)).toBe(true);
  });

  it('preserves the shared All Outlets consolidated mode', async () => {
    appointmentsMock.mockResolvedValue({
      items: [appointment(APPOINTMENT_1, OUTLET_1), appointment(APPOINTMENT_2, OUTLET_2, 'CONFIRMED')],
      page: 0,
      pageSize: 50,
      hasNext: false,
    });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByType(MerchantHeader).props.onSelectOutlet(undefined);
    });
    await flush();

    expect(appointmentsMock).toHaveBeenLastCalledWith({ outletId: undefined, page: 0, pageSize: 50 });
    const data = renderer.root.findByProps({ testID: 'appointments-list' }).props.data as MerchantAppointmentRequest[];
    expect(data.map((item) => item.outletId).sort()).toEqual([OUTLET_1, OUTLET_2].sort());
    expect(renderer.root.findByType(MerchantHeader).props.outletName).toBe('All Outlets');
  });

  it('clears previous-outlet data when an offline outlet switch cannot load', async () => {
    appointmentsMock.mockImplementation(async (options) => {
      if (options?.outletId === OUTLET_2) throw new Error('Network request failed');
      return { items: [appointment(APPOINTMENT_1, OUTLET_1)], page: 0, pageSize: 50, hasNext: false };
    });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByType(MerchantHeader).props.onSelectOutlet(OUTLET_2);
    });
    await flush();

    const list = renderer.root.findByProps({ testID: 'appointments-list' });
    expect(list.props.data).toEqual([]);
    const alerts = renderer.root.findAll((node) => node.props.accessibilityRole === 'alert');
    expect(alerts.some((node) => String(node.props.children).includes('no appointment cache is available for this outlet scope'))).toBe(true);
  });

  it('paginates beyond the first page and merges canonical records', async () => {
    appointmentsMock.mockImplementation(async (options) => (options?.page ?? 0) === 0
      ? { items: [appointment(APPOINTMENT_1)], page: 0, pageSize: 50, hasNext: true }
      : { items: [appointment(APPOINTMENT_2)], page: 1, pageSize: 50, hasNext: false });
    const renderer = await renderScreen();

    await act(async () => {
      renderer.root.findByProps({ testID: 'appointments-list' }).props.onEndReached();
    });
    await flush();

    expect(appointmentsMock).toHaveBeenLastCalledWith({ outletId: OUTLET_1, page: 1, pageSize: 50 });
    const data = renderer.root.findByProps({ testID: 'appointments-list' }).props.data as MerchantAppointmentRequest[];
    expect(data.map((item) => item.appointmentId)).toEqual([APPOINTMENT_1, APPOINTMENT_2]);
  });

  it('resolves a deep-linked appointment canonically even when it is absent from page zero', async () => {
    mockSearchParams.mockReturnValue({ appointmentId: APPOINTMENT_2 });
    appointmentsMock.mockImplementation(async (options) => ({
      items: options?.outletId === OUTLET_1 ? [appointment(APPOINTMENT_1)] : [],
      page: 0,
      pageSize: 50,
      hasNext: false,
    }));
    singleAppointmentMock.mockResolvedValue(appointment(APPOINTMENT_2, OUTLET_2, 'CONFIRMED'));
    const renderer = await renderScreen();
    await flush();

    expect(singleAppointmentMock).toHaveBeenCalledWith(APPOINTMENT_2);
    expect(appointmentsMock).toHaveBeenCalledWith({ outletId: OUTLET_2, page: 0, pageSize: 50 });
    const detail = renderer.root.findByType(AppointmentDetailModal);
    expect(detail.props.visible).toBe(true);
    expect(detail.props.appointment?.appointmentId).toBe(APPOINTMENT_2);
  });

  it('passes the typed destructive reason into the canonical transition call', async () => {
    const renderer = await renderScreen();
    const card = renderer.root.findByType(AppointmentCard);

    await act(async () => {
      card.props.onTransition(card.props.appointment, 'REJECTED');
    });
    const confirmation = renderer.root.findByType(ConfirmationModal);
    expect(confirmation.props.requireReason).toBe(true);

    await act(async () => {
      confirmation.props.onConfirm('Clinic emergency');
    });
    await flush();

    expect(transitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ appointmentId: APPOINTMENT_1 }),
      'REJECTED',
      'Clinic emergency',
    );
  });

  it('exposes no-show as a real detail action instead of hiding it behind cancel', async () => {
    appointmentsMock.mockResolvedValue({
      items: [appointment(APPOINTMENT_1, OUTLET_1, 'CONFIRMED')],
      page: 0,
      pageSize: 50,
      hasNext: false,
    });
    const renderer = await renderScreen();
    const card = renderer.root.findByType(AppointmentCard);

    await act(async () => {
      card.props.onViewDetails(card.props.appointment);
    });

    expect(renderer.root.findByProps({ testID: 'modal-action-NO_SHOW' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'modal-action-CANCELLED' })).toBeTruthy();
  });
});
