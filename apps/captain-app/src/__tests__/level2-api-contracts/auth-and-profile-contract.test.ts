import { fetchCaptainProfile } from '../../api/captain';
import { fetchActiveDelivery, fetchDeliveryHistory } from '../../api/deliveries';
import { fetchCaptainEarnings } from '../../api/earnings';
import { fetchCaptainNotifications, markNotificationRead } from '../../api/notifications';
import { createSupportTicket } from '../../api/support';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';

describe('Level 2: Auth, Profile & Operations API Contract Tests', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('profile-contract-jwt');
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('GET /api/v1/captain/profile contract', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        captainId: 'cap-999',
        name: 'Arjun Verma',
        mobile: '+919876543210',
        status: 'ACTIVE',
        approved: true,
        online: true,
        busy: false,
      }),
    });

    const profile = await fetchCaptainProfile();
    expect(profile.captainId).toBe('cap-999');
    expect(profile.status).toBe('ACTIVE');
  });

  it('GET /api/v1/captain/delivery/active and /history contracts', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 404,
      json: async () => ({ message: 'No active job' }),
    });

    const active = await fetchActiveDelivery();
    expect(active).toBeNull();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const history = await fetchDeliveryHistory();
    expect(history).toEqual([]);
  });

  it('GET /api/v1/captain/earnings/summary contract', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        todayPaise: 8500,
        todayDeliveryCount: 2,
        thisWeekPaise: 34000,
        thisMonthPaise: 150000,
        recentEarnings: [],
        settlements: [],
      }),
    });

    const earnings = await fetchCaptainEarnings();
    expect(earnings.todayPaise).toBe(8500);
    expect(earnings.todayDeliveryCount).toBe(2);
  });

  it('GET /api/v1/captain/notifications and read receipt contract', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 'notif-1',
          type: 'DISPATCH',
          title: 'New Order',
          message: 'Order ready for pickup',
          createdAt: '2026-08-23T10:00:00Z',
          read: false,
        },
      ],
    });

    const notifs = await fetchCaptainNotifications();
    expect(notifs).toHaveLength(1);
    expect(notifs[0].id).toBe('notif-1');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    await markNotificationRead('notif-1');
  });

  it('POST /api/v1/captain/support/tickets contract', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        ticketId: 'SUP-2026-001',
        status: 'OPEN',
        createdAt: '2026-08-23T11:00:00Z',
      }),
    });

    const ticket = await createSupportTicket({
      category: 'ACTIVE_DELIVERY',
      subject: 'Store is closed',
      description: 'Arrived at outlet but store is shuttered',
      jobId: 'job-101',
    });

    expect(ticket.ticketId).toBe('SUP-2026-001');
    expect(ticket.status).toBe('OPEN');
  });
});
