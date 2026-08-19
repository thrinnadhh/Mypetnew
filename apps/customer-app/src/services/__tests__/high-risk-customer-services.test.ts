import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiClient } from '../api-client';
import {
  clearPendingPayment,
  fetchPaymentStatus,
  initiateOrderPayment,
  loadPendingPayment,
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
    environment: 'development',
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

const mockOpenCashfreeNativeCheckout = jest.fn();

jest.mock('../cashfree-native', () => ({
  openCashfreeNativeCheckout: mockOpenCashfreeNativeCheckout,
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;
const mockedFetch = jest.fn();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const payment = {
  paymentId: 'payment-1',
  referenceType: 'PRODUCT_ORDER' as const,
  referenceId: 'order-1',
  provider: 'CASHFREE' as const,
  providerOrderId: 'mp_12345678901234567890123456789012',
  status: 'PENDING' as const,
  paymentSessionId: 'session-1',
  expiresAt: '2026-08-15T12:15:00Z',
  amountPaise: 49_900,
  currency: 'INR' as const,
  refundStatus: null,
};

describe('high-risk customer service contracts', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockedFetch.mockReset();
    global.fetch = mockedFetch as unknown as typeof fetch;
    await AsyncStorage.clear();
  });

  describe('payments', () => {
    it('initiates only the canonical server-authoritative product payment request', async () => {
      mockedApiClient.post.mockResolvedValueOnce(payment);

      await expect(initiateOrderPayment('order-1', 'idem-1')).resolves.toEqual(payment);

      expect(mockedApiClient.post).toHaveBeenCalledWith(
        '/api/v1/customer/payments',
        {
          referenceType: 'PRODUCT_ORDER',
          referenceId: 'order-1',
          provider: 'CASHFREE',
        },
        { 'Idempotency-Key': 'idem-1' },
      );
      expect(JSON.stringify(mockedApiClient.post.mock.calls[0])).not.toContain('userId');
      expect(JSON.stringify(mockedApiClient.post.mock.calls[0])).not.toContain('amountPaise');
      expect(await loadPendingPayment()).toEqual({ paymentId: 'payment-1', orderId: 'order-1' });
    });

    it('treats native Cashfree callbacks only as a signal to verify backend truth', async () => {
      mockOpenCashfreeNativeCheckout.mockResolvedValueOnce('VERIFY');

      await expect(openCashfreeOrder(payment)).resolves.toBe('VERIFY');

      expect(mockOpenCashfreeNativeCheckout).toHaveBeenCalledWith({
        paymentSessionId: payment.paymentSessionId,
        providerOrderId: payment.providerOrderId,
      });
      expect(mockedApiClient.post).not.toHaveBeenCalled();
    });

    it('polls only canonical payment status and clears recovery after capture', async () => {
      mockedApiClient.get
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, status: 'CAPTURED' });
      await AsyncStorage.setItem(
        'mypet.customer.pending-payment.v1',
        JSON.stringify({ paymentId: payment.paymentId, orderId: payment.referenceId }),
      );

      const result = await waitForPaymentOutcome(payment.paymentId, 3, 0);

      expect(result.status).toBe('CAPTURED');
      expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
      expect(mockedApiClient.get).toHaveBeenNthCalledWith(1, '/api/v1/customer/payments/payment-1');
      expect(mockedApiClient.post).not.toHaveBeenCalled();
      expect(await loadPendingPayment()).toBeNull();
    });

    it('reads owned server payment status and recovery storage contains safe ids only', async () => {
      mockedApiClient.get.mockResolvedValueOnce({ ...payment, status: 'AUTHORIZED' });

      await expect(fetchPaymentStatus('payment/1')).resolves.toMatchObject({ status: 'AUTHORIZED' });
      expect(mockedApiClient.get).toHaveBeenCalledWith('/api/v1/customer/payments/payment%2F1');

      await AsyncStorage.setItem(
        'mypet.customer.pending-payment.v1',
        JSON.stringify({ paymentId: 'payment-2', orderId: 'order-2' }),
      );
      expect(await loadPendingPayment()).toEqual({ paymentId: 'payment-2', orderId: 'order-2' });
      await clearPendingPayment('payment-2');
      expect(await loadPendingPayment()).toBeNull();
    });
  });

  describe('recurring orders', () => {
    it('sends authenticated create, update, confirm and paginated list requests', async () => {
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
        .mockResolvedValueOnce(jsonResponse({ items: [subscription], page: 0, pageSize: 20, hasNext: false }))
        .mockResolvedValueOnce(jsonResponse(subscription, 201))
        .mockResolvedValueOnce(jsonResponse({ ...subscription, status: 'PAUSED' }))
        .mockResolvedValueOnce(jsonResponse({ subscription, reorder: { canReorder: true, items: [] } }));

      await expect(fetchRecurringOrders('access-token')).resolves.toHaveLength(1);
      await createRecurringOrder('order-1', 15, 2, 'access-token');
      await updateRecurringOrder('sub-1', 'PAUSE', 'access-token');
      await confirmRecurringOrder('sub-1', 'access-token');

      expect(mockedFetch.mock.calls.map((call) => [call[0], call[1]?.method ?? 'GET'])).toEqual([
        ['https://api.mypet.test/api/v1/customer/recurring-orders?page=0&pageSize=20', 'GET'],
        ['https://api.mypet.test/api/v1/customer/recurring-orders', 'POST'],
        ['https://api.mypet.test/api/v1/customer/recurring-orders/sub-1', 'PATCH'],
        ['https://api.mypet.test/api/v1/customer/recurring-orders/sub-1/confirm', 'POST'],
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
    it('uses canonical customer-owned appointment detail and cancellation while hiding unsupported actions', async () => {
  mockedFetch
    .mockResolvedValueOnce(jsonResponse({
      appointmentId: 'appointment-1',
      outletId: 'provider-1',
      providerId: 'provider-1',
      serviceId: 'offering-1',
      offeringId: 'offering-1',
      slotId: 'slot-1',
      petId: 'pet-1',
      providerName: 'Happy Paws Clinic',
      serviceName: 'Vet Consultation',
      petName: 'Milo',
      startsAt: '2026-08-20T10:00:00Z',
      endsAt: '2026-08-20T10:30:00Z',
      status: 'BOOKED',
      paymentMethod: 'PAY_AT_PROVIDER',
      paymentStatus: 'NOT_REQUIRED',
      pricePaise: 65000,
      currency: 'INR',
      holdExpiresAt: null,
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:00:00Z',
    }))
    .mockResolvedValueOnce(jsonResponse({
      appointmentId: 'appointment-1',
      outletId: 'provider-1',
      serviceId: 'offering-1',
      slotId: 'slot-1',
      petId: 'pet-1',
      providerName: 'Happy Paws Clinic',
      serviceName: 'Vet Consultation',
      petName: 'Milo',
      startsAt: '2026-08-20T10:00:00Z',
      endsAt: '2026-08-20T10:30:00Z',
      status: 'CANCELLED',
      paymentMethod: 'PAY_AT_PROVIDER',
      paymentStatus: 'NOT_REQUIRED',
      pricePaise: 65000,
      currency: 'INR',
      holdExpiresAt: null,
      createdAt: '2026-08-16T00:00:00Z',
      updatedAt: '2026-08-16T00:01:00Z',
    }));

  const details = await fetchAppointmentDetails('appointment-1', 'token');
  expect(details).toMatchObject({
    providerName: 'Happy Paws Clinic',
    serviceName: 'Vet Consultation',
    petName: 'Milo',
    priceAmount: 650,
    slotStartsAt: '2026-08-20T10:00:00Z',
    canReview: false,
  });
  await cancelAppointment('appointment-1', 'Pet is unwell & resting', 'token');
  await expect(rescheduleAppointment('appointment-1', 'slot/2', 'token'))
    .rejects.toThrow('rescheduling is not available');
  await expect(submitAppointmentReview({
    customerId: 'customer-1',
    providerId: 'provider-1',
    targetId: 'appointment-1',
    rating: 5,
    comment: ' Excellent ',
    accessToken: 'token',
  })).rejects.toThrow('reviews are not available');

  expect(mockedFetch.mock.calls[0][0]).toBe(
    'https://api.mypet.test/api/v1/customer/appointments/appointment-1',
  );
  expect(mockedFetch.mock.calls[1][0]).toBe(
    'https://api.mypet.test/api/v1/customer/appointments/appointment-1/cancel',
  );
  expect(mockedFetch.mock.calls[1][1]?.method).toBe('POST');
  expect(JSON.parse(mockedFetch.mock.calls[1][1]?.body as string)).toEqual({
    reason: 'Pet is unwell & resting',
  });
  expect(mockedFetch).toHaveBeenCalledTimes(2);
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
});
