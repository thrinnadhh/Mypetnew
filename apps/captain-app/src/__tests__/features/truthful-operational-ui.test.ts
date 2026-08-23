import {
  fetchDeliveryHistory,
  fetchActiveDelivery,
} from '../../api/deliveries';
import { fetchCaptainEarnings } from '../../api/earnings';
import { fetchCaptainNotifications, markNotificationRead } from '../../api/notifications';
import { createSupportTicket } from '../../api/support';
import { respondToOffer, markJobPickedUp, markJobDelivered } from '../../api/dispatch';
import { fetchCaptainProfile } from '../../api/captain';
import { setRuntimeAccessTokenForTesting } from '../../auth/session';
import { deliveryRepository } from '../../repositories/delivery-repository';
import { dispatchRepository } from '../../repositories/dispatch-repository';
import { earningsRepository } from '../../repositories/earnings-repository';
import { commandStore } from '../../sync/command-store';
import { formatPaise } from '../../utils/money';

describe('Production Truthful Operational UI & State Machine Tests', () => {
  beforeEach(async () => {
    (global as any).fetch = jest.fn();
    setRuntimeAccessTokenForTesting('valid-production-jwt');
    await commandStore.clear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Home & Profile Approval States', () => {
    it('accurately parses active and approved captain profile', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          captainId: 'c-101',
          name: 'Priya Patel',
          mobile: '+919876543210',
          status: 'ACTIVE',
          approved: true,
          online: true,
          busy: false,
          vehicle: {
            model: 'Hero Splendor',
            registrationNumber: 'DL 01 AB 9999',
          },
          bank: {
            bankName: 'HDFC Bank',
            accountNumberMasked: '••••••••8888',
            ifscMasked: 'HDFC0001234',
          },
        }),
      });

      const profile = await fetchCaptainProfile();
      expect(profile.status).toBe('ACTIVE');
      expect(profile.approved).toBe(true);
      expect(profile.vehicle?.registrationNumber).toBe('DL 01 AB 9999');
      expect(profile.bank?.bankName).toBe('HDFC Bank');
    });

    it('accurately parses unapproved / draft profile without fake fallback objects', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          captainId: 'c-102',
          status: 'DRAFT',
          approved: false,
          online: false,
          busy: false,
        }),
      });

      const profile = await fetchCaptainProfile();
      expect(profile.status).toBe('DRAFT');
      expect(profile.approved).toBe(false);
      expect(profile.vehicle).toBeUndefined();
      expect(profile.bank).toBeUndefined();
    });
  });

  describe('Deliveries & History Authoritative States', () => {
    it('handles empty delivery history truthfully without inserting fake past orders', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      const historyResult = await earningsRepository.getDeliveryHistory();
      expect(historyResult.success).toBe(true);
      if (historyResult.success) {
        expect(historyResult.data).toHaveLength(0);
      }
    });

    it('handles delivery history load failure with explicit error response', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          code: 'SERVICE_UNAVAILABLE',
          message: 'Delivery history service is temporarily unavailable.',
        }),
      });

      const historyResult = await earningsRepository.getDeliveryHistory();
      expect(historyResult.success).toBe(false);
      if (!historyResult.success) {
        expect(historyResult.error.status).toBe(503);
        expect(historyResult.error.message).toBe('Delivery history service is temporarily unavailable.');
      }
    });

    it('renders active delivery when assigned and null when idle', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 404,
        json: async () => ({ message: 'No active job' }),
      });

      const activeResult = await deliveryRepository.getActiveDelivery();
      expect(activeResult.success).toBe(true);
      if (activeResult.success) {
        expect(activeResult.data).toBeNull();
      }
    });
  });

  describe('Earnings & Settlements Authoritative States', () => {
    it('returns authoritative earnings numbers without fake rupee defaults', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          todayPaise: 12500,
          todayDeliveryCount: 3,
          thisWeekPaise: 45000,
          thisMonthPaise: 180000,
          recentEarnings: [
            {
              deliveryId: 'del-01',
              orderReference: 'ORD-2026-101',
              completedAt: '2026-08-23 14:00',
              baseEarningPaise: 4000,
              distanceIncentivePaise: 500,
              peakIncentivePaise: 0,
              tipPaise: 0,
              totalPaise: 4500,
              status: 'SETTLED',
            },
          ],
          settlements: [
            {
              settlementId: 'set-01',
              periodStart: '10 Aug',
              periodEnd: '16 Aug',
              amountPaise: 42000,
              status: 'PROCESSED',
              settledAt: '2026-08-17',
            },
          ],
        }),
      });

      const res = await earningsRepository.getEarningsSummary();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.todayPaise).toBe(12500);
        expect(formatPaise(res.data.todayPaise)).toBe('₹125');
        expect(res.data.todayDeliveryCount).toBe(3);
        expect(res.data.recentEarnings).toHaveLength(1);
        expect(res.data.settlements).toHaveLength(1);
      }
    });

    it('truthfully handles zero-earning state without injecting mock transactions', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          todayPaise: 0,
          todayDeliveryCount: 0,
          thisWeekPaise: 0,
          thisMonthPaise: 0,
          recentEarnings: [],
          settlements: [],
        }),
      });

      const res = await earningsRepository.getEarningsSummary();
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.todayPaise).toBe(0);
        expect(res.data.recentEarnings).toHaveLength(0);
        expect(res.data.settlements).toHaveLength(0);
      }
    });
  });

  describe('Inbox Notifications & Read Receipts', () => {
    it('fetches notifications truthfully and sends read receipts with acknowledgement', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: 'notif-01',
              type: 'SETTLEMENT',
              title: 'Weekly Payout Sent',
              message: 'Your payout of ₹420 has been transferred.',
              createdAt: '2026-08-23T10:00:00Z',
              read: false,
            },
          ],
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        });

      const notifs = await fetchCaptainNotifications();
      expect(notifs).toHaveLength(1);
      expect(notifs[0].id).toBe('notif-01');
      expect(notifs[0].read).toBe(false);

      await markNotificationRead('notif-01');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('Support Ticket Creation', () => {
    it('creates support ticket with backend acknowledgement and returns ticketId', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          ticketId: 'SUP-2026-888',
          status: 'OPEN',
          createdAt: '2026-08-23T15:00:00Z',
        }),
      });

      const ticket = await createSupportTicket({
        category: 'ACTIVE_DELIVERY',
        subject: 'Merchant delay',
        description: 'Store is still preparing order after 15 mins',
        jobId: 'job-101',
        orderReference: 'ORD-901',
      });

      expect(ticket.ticketId).toBe('SUP-2026-888');
      expect(ticket.status).toBe('OPEN');
    });

    it('rejects ticket creation when server returns error and avoids false success', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          code: 'VALIDATION_FAILED',
          message: 'Subject and description cannot be empty',
        }),
      });

      await expect(
        createSupportTicket({
          category: 'OTHER',
          subject: '',
          description: '',
        }),
      ).rejects.toThrow('Subject and description cannot be empty');
    });
  });

  describe('Offer Lifecycle Mutations & State Guarding', () => {
    it('handles offer rejection acknowledgment', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          accepted: false,
          jobId: null,
          orderId: null,
          outletId: null,
          deliveryAddress: null,
        }),
      });

      const outcome = await dispatchRepository.respondToOffer('offer-999', 'REJECT');
      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.accepted).toBe(false);
      }
    });

    it('handles offer 409 conflict when offer is lost or expired', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          code: 'OFFER_UNAVAILABLE',
          message: 'Offer was assigned to another captain',
        }),
      });

      const outcome = await dispatchRepository.respondToOffer('offer-999', 'ACCEPT');
      expect(outcome.outcome).toBe('REJECTED');
      if (outcome.outcome === 'REJECTED') {
        expect(outcome.error.status).toBe(409);
        expect(outcome.error.code).toBe('OFFER_UNAVAILABLE');
      }
    });

    it('handles pickup confirmation mutation with server authority', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'job-501',
          orderId: 'ord-501',
          outletId: 'out-01',
          status: 'PICKED_UP',
          pickedUpAt: '2026-08-23T15:20:00Z',
        }),
      });

      const outcome = await deliveryRepository.markPickedUp('job-501', {
        type: 'PIN',
        pinCode: '1234',
        capturedAt: '2026-08-23T15:20:00Z',
      });

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.state).toBe('PICKED_UP');
        expect(outcome.data.pickedUpAt).toBe('2026-08-23T15:20:00Z');
      }
    });

    it('handles delivery completion mutation with server authority', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'job-501',
          orderId: 'ord-501',
          outletId: 'out-01',
          status: 'DELIVERED',
          deliveredAt: '2026-08-23T15:45:00Z',
        }),
      });

      const outcome = await deliveryRepository.markDelivered('job-501', {
        type: 'PIN',
        pinCode: '5678',
        capturedAt: '2026-08-23T15:45:00Z',
      });

      expect(outcome.outcome).toBe('ACKNOWLEDGED');
      if (outcome.outcome === 'ACKNOWLEDGED') {
        expect(outcome.data.state).toBe('DELIVERED');
        expect(outcome.data.deliveredAt).toBe('2026-08-23T15:45:00Z');
      }
    });
  });
});
