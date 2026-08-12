import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';

import { apiClient } from '../api-client';
import {
  createHostedCheckoutSession,
  fetchOrderPaymentStatus,
  initiateOrderPayment,
  openCashfreeOrder,
  waitForPaymentOutcome,
} from '../customer-payments';
import {
  confirmRecurringOrder,
  createRecurringOrder,
  fetchRecurringOrders,
  updateRecurringOrder,
} from '../recurring-orders';
import {
  fetchMessages,
  markConversationRead,
  openConversation,
  sendImageMessage,
  sendTextMessage,
  updateConversationPrivacy,
} from '../chat';
import {
  cancelAppointment,
  fetchAppointmentDetails,
  rescheduleAppointment,
  submitAppointmentReview,
} from '../customer-history';
import {
  fetchLocale,
  fetchVaccinationReminders,
  setVaccinationReminderEnabled,
  updateLocale,
} from '../preferences';
import {
  fetchMedicalDocuments,
  getMedicalDocumentLink,
  uploadMedicalDocument,
} from '../medical-documents';

jest.mock('@/utils/app-config', () => ({
  appConfig: {
    apiBaseUrl: 'https://api.mypet.test',
    allowDemoMode: false,
  },
}));

jest.mock('../api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedBrowser = WebBrowser as jest.Mocked<typeof WebBrowser>;
const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const payment = {
  transactionId: 'txn-1',
  referenceId: 'order/1',
  transactionType: 'ORDER_PAYMENT',
  amount: 499,
  currency: 'INR',
  status: 'SUCCESS' as const,
  createdAt: '2026-08-06T00:00:00Z',
  updatedAt: '2026-08-06T00:01:00Z',
};

describe('high-risk customer service contracts', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    await AsyncStorage.clear();
  });

  describe('payments', () => {
    it('normalizes customer details and creates Cashfree order payments', async () => {
      mockedApiClient.post.mockResolvedValueOnce({
        orderId: 'cf-order-1',
        paymentSessionId: 'session-1',
        amount: 499,
        currency: 'INR',
        transactionId: 'txn-1',
        environment: 'SANDBOX',
      });

      await initiateOrderPayment('user-1', 'order-1', 499, {
        phone: '+91 98765 43210',
        email: ' customer@example.com ',
        name: ' Customer ',
      });

      expect(mockedApiClient.post).toHaveBeenCalledWith('/api/v1/payments/orders', {
        userId: 'user-1',
        referenceId: 'order-1',
        amount: 499,
        transactionType: 'ORDER_PAYMENT',
        customerPhone: '9876543210',
        customerEmail: 'customer@example.com',
        customerName: 'Customer',
      });

      await expect(
        initiateOrderPayment('user-1', 'order-1', 499, { phone: '1234' }),
      ).rejects.toThrow('valid Indian mobile number');
    });

    it('opens only a valid hosted checkout session with the app return scheme', async () => {
      mockedApiClient.post.mockResolvedValueOnce({
        checkoutPath: '/api/v1/payments/checkout/txn-1?token=signed',
        expiresAt: '2026-08-06T00:15:00Z',
      });
      mockedBrowser.openAuthSessionAsync.mockResolvedValue({ type: 'success', url: 'customerapp://payments/result' });

      await openCashfreeOrder({
        orderId: 'cf-order-1',
        paymentSessionId: 'session-1',
        amount: 499,
        currency: 'INR',
        transactionId: 'txn-1',
        environment: 'SANDBOX',
      });

      expect(mockedApiClient.post).toHaveBeenCalledWith('/api/v1/payments/checkout-sessions', {
        transactionId: 'txn-1',
      });
      expect(mockedBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
        'https://api.mypet.test/api/v1/payments/checkout/txn-1?token=signed',
        'customerapp://payments/result',
        expect.objectContaining({ preferEphemeralSession: true }),
      );

      await expect(
        openCashfreeOrder({
          orderId: '',
          paymentSessionId: '',
          amount: 499,
          currency: 'INR',
          transactionId: 'txn-1',
          environment: 'SANDBOX',
        }),
      ).rejects.toThrow('invalid checkout session');
    });

    it('observes authoritative payment status without client reconciliation or order confirmation', async () => {
      mockedApiClient.get.mockResolvedValueOnce(payment);

      await expect(fetchOrderPaymentStatus('order/1')).resolves.toEqual(payment);
      expect(mockedApiClient.get).toHaveBeenCalledWith(
        '/api/v1/payments/transactions/reference/order%2F1',
      );
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });

    it('polls pending outcomes with GET only and stops after a terminal status', async () => {
      mockedApiClient.get
        .mockResolvedValueOnce({ ...payment, status: 'PENDING' })
        .mockResolvedValueOnce({ ...payment, status: 'FAILED' });

      const result = await waitForPaymentOutcome('order-1', 3, 0);

      expect(result.status).toBe('FAILED');
      expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
      expect(mockedApiClient.get).toHaveBeenNthCalledWith(
        1,
        '/api/v1/payments/transactions/reference/order-1',
      );
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });
  });

  describe('recurring orders', () => {
    it('sends authenticated create, update, confirm and list requests', async () => {
      const subscription = {
        subscriptionId: 'sub-1',
        customerId: 'customer-1',
        providerId: 'provider-1',
        sourceOrderId: 'order-1',
        deliveryAddressId: 'address-1',
        cadenceDays: 15,
        quantityMultiplier: 2,
        status: 'ACTIVE',
        nextOrderAt: '2026-08-21T00:00:00Z',
        lastRemindedAt: null,
        createdAt: '2026-08-06T00:00:00Z',
        updatedAt: '2026-08-06T00:00:00Z',
      };
      mockedFetch
        .mockResolvedValueOnce(jsonResponse([subscription]))
        .mockResolvedValueOnce(jsonResponse(subscription, 201))
        .mockResolvedValueOnce(jsonResponse({ ...subscription, status: 'PAUSED' }))
        .mockResolvedValueOnce(jsonResponse({ subscription, reorder: { canReorder: true, items: [] } }));

      await expect(fetchRecurringOrders('access-token')).resolves.toHaveLength(1);
      await createRecurringOrder('order-1', 15, 2, 'access-token');
      await updateRecurringOrder('sub-1', 'PAUSE', 'access-token');
      await confirmRecurringOrder('sub-1', 'access-token');

      expect(mockedFetch.mock.calls.map((call) => [call[0], call[1]?.method ?? 'GET'])).toEqual([
        ['https://api.mypet.test/api/v1/orders/subscriptions', 'GET'],
        ['https://api.mypet.test/api/v1/orders/subscriptions', 'POST'],
        ['https://api.mypet.test/api/v1/orders/subscriptions/sub-1', 'PATCH'],
        ['https://api.mypet.test/api/v1/orders/subscriptions/sub-1/confirm', 'POST'],
      ]);
      expect(JSON.parse(mockedFetch.mock.calls[1][1]?.body as string)).toEqual({
        sourceOrderId: 'order-1',
        cadenceDays: 15,
        quantityMultiplier: 2,
      });
      expect(mockedFetch.mock.calls[0][1]?.headers).toMatchObject({
        Authorization: 'Bearer access-token',
      });
    });
  });

  describe('chat', () => {
    it('opens a conversation and sends text, image and privacy mutations', async () => {
      const conversation = { conversationId: 'conversation-1' };
      const message = { messageId: 'message-1' };
      mockedFetch
        .mockResolvedValueOnce(jsonResponse(conversation, 201))
        .mockResolvedValueOnce(jsonResponse(message, 201))
        .mockResolvedValueOnce(jsonResponse(message, 201))
        .mockResolvedValueOnce(jsonResponse(conversation));

      await openConversation({
        contextType: 'ORDER',
        contextId: 'order-1',
        providerId: 'provider-1',
        customerId: 'customer-1',
        accessToken: 'token',
      });
      await sendTextMessage('conversation-1', 'Hello', 'token');
      await sendImageMessage('conversation-1', 'https://files/image.jpg', 'image/jpeg', 'Photo', 'token');
      await updateConversationPrivacy('conversation-1', { customerPhoneVisible: false }, 'token');

      expect(JSON.parse(mockedFetch.mock.calls[1][1]?.body as string)).toEqual({
        messageType: 'TEXT',
        body: 'Hello',
      });
      expect(JSON.parse(mockedFetch.mock.calls[2][1]?.body as string)).toEqual({
        messageType: 'IMAGE',
        imageUrl: 'https://files/image.jpg',
        imageMimeType: 'image/jpeg',
        body: 'Photo',
      });
      expect(mockedFetch.mock.calls[3][1]?.method).toBe('PATCH');
    });

    it('encodes message cursors, marks read and surfaces API errors', async () => {
      mockedFetch
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse(null, 204))
        .mockResolvedValueOnce(jsonResponse({ error: 'Conversation access denied' }, 403));

      await fetchMessages('conversation-1', 'token', '2026-08-06T00:00:00+05:30');
      await markConversationRead('conversation-1', 'token');
      await expect(sendTextMessage('conversation-1', 'Blocked', 'token')).rejects.toThrow(
        'Conversation access denied',
      );

      expect(mockedFetch.mock.calls[0][0]).toContain(
        'after=2026-08-06T00%3A00%3A00%2B05%3A30',
      );
      expect(mockedFetch.mock.calls[1][1]?.method).toBe('POST');
    });
  });

  describe('appointment history and preferences', () => {
    it('enriches appointment details and sends encoded mutations', async () => {
      mockedFetch
        .mockResolvedValueOnce(jsonResponse({
          appointmentId: 'appointment-1',
          customerId: 'customer-1',
          providerId: 'provider-1',
          offeringId: 'offering-1',
          slotId: 'slot-1',
          petId: 'pet-1',
          status: 'CONFIRMED',
          priceAmount: '650.00',
        }))
        .mockResolvedValueOnce(jsonResponse({
          providerId: 'provider-1',
          name: 'Happy Paws Clinic',
          address: 'Tirupati',
          phone: '9876543210',
        }))
        .mockResolvedValueOnce(jsonResponse([{ offeringId: 'offering-1', name: 'Vet Consultation' }]))
        .mockResolvedValueOnce(jsonResponse({ slotStart: '2026-08-10T10:00:00Z' }))
        .mockResolvedValueOnce(jsonResponse({ status: 'CANCELLED' }))
        .mockResolvedValueOnce(jsonResponse({ status: 'CONFIRMED' }))
        .mockResolvedValueOnce(jsonResponse({ error: 'duplicate' }, 409));

      const details = await fetchAppointmentDetails('appointment-1', 'token');
      expect(details).toMatchObject({
        providerName: 'Happy Paws Clinic',
        serviceName: 'Vet Consultation',
        priceAmount: 650,
        slotStartsAt: '2026-08-10T10:00:00Z',
      });
      await cancelAppointment('appointment-1', 'Pet is unwell & resting', 'token');
      await rescheduleAppointment('appointment-1', 'slot/2', 'token');
      await expect(submitAppointmentReview({
        customerId: 'customer-1',
        providerId: 'provider-1',
        targetId: 'appointment-1',
        rating: 5,
        comment: ' Excellent ',
        accessToken: 'token',
      })).resolves.toBe('duplicate');

      expect(mockedFetch.mock.calls[4][0]).toContain('note=Pet%20is%20unwell%20%26%20resting');
      expect(mockedFetch.mock.calls[5][0]).toContain('newSlotId=slot/2');
    });

    it('loads and updates locale and vaccination reminder settings', async () => {
      mockedFetch
        .mockResolvedValueOnce(jsonResponse({ locale: 'te' }))
        .mockResolvedValueOnce(jsonResponse({}))
        .mockResolvedValueOnce(jsonResponse([{
          reminderId: 42,
          petId: 'pet-1',
          vaccineName: 'Rabies',
          dueDate: '2026-12-02',
          clinicName: null,
          enabled: true,
        }]))
        .mockResolvedValueOnce(jsonResponse({}));

      await expect(fetchLocale('token')).resolves.toBe('te');
      await updateLocale('en', 'token');
      const reminders = await fetchVaccinationReminders('token');
      await setVaccinationReminderEnabled('42', false, 'token');

      expect(reminders[0].reminderId).toBe('42');
      expect(JSON.parse(mockedFetch.mock.calls[1][1]?.body as string)).toEqual({ locale: 'en' });
      expect(JSON.parse(mockedFetch.mock.calls[3][1]?.body as string)).toEqual({ enabled: false });
    });
  });

  describe('private medical documents', () => {
    it('lists, reserves, uploads and requests a signed link without forcing multipart content type', async () => {
      const document = {
        documentId: 'document-1',
        appointmentId: 'appointment-1',
        originalFilename: 'report.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 25,
        status: 'AVAILABLE',
        createdAt: '2026-08-06T00:00:00Z',
      };
      mockedFetch
        .mockResolvedValueOnce(jsonResponse([document]))
        .mockResolvedValueOnce(jsonResponse({
          uploadToken: 'upload-token',
          uploadUrl: 'https://api.mypet.test/private-upload',
          expiresAt: '2026-08-06T00:10:00Z',
        }))
        .mockResolvedValueOnce(jsonResponse(document, 201))
        .mockResolvedValueOnce(jsonResponse({ url: 'https://signed.mypet.test/document-1' }));

      await expect(fetchMedicalDocuments('token')).resolves.toEqual([document]);
      await expect(uploadMedicalDocument('appointment/1', {
        uri: 'file:///report.pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
      }, 'token')).resolves.toEqual(document);
      await expect(getMedicalDocumentLink('document/1', 'token', 'attachment')).resolves.toBe(
        'https://signed.mypet.test/document-1',
      );

      expect(mockedFetch.mock.calls[1][0]).toContain('appointmentId=appointment%2F1');
      expect(mockedFetch.mock.calls[2][0]).toBe('https://api.mypet.test/private-upload');
      expect(mockedFetch.mock.calls[2][1]?.headers).toEqual({
        Authorization: 'Bearer token',
        Accept: 'application/json',
      });
      expect(mockedFetch.mock.calls[3][0]).toContain('document%2F1/signed-link?disposition=attachment');
    });
  });

  it('exposes the standalone hosted-session helper for callers that prefetch checkout', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      checkoutPath: 'https://checkout.mypet.test/session',
      expiresAt: '2026-08-06T00:15:00Z',
    });
    await expect(createHostedCheckoutSession('txn-1')).resolves.toMatchObject({
      checkoutPath: 'https://checkout.mypet.test/session',
    });
  });
});
