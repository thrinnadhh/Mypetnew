import { apiClient } from '@/services/api-client';
import { fetchCustomerOrderTracking, fetchDeliveryQuote } from '@/services/customer-delivery';

jest.mock('@/services/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const getMock = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const postMock = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe('P5 canonical Customer delivery client', () => {
  it('requests a server-owned delivery quote with normalized payment method and no customer id', async () => {
    postMock.mockResolvedValue({
      id: 'quote-1',
      customerId: 'server-customer',
      outletId: 'outlet-1',
      cartSignature: 'signature',
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
      paymentMethod: 'PAY_ON_FULFILMENT',
      pricing: {
        itemSubtotalPaise: 20_000,
        itemDiscountPaise: 0,
        couponDiscountPaise: 0,
        loyaltyRewardPaise: 0,
        taxPaise: 0,
        platformFeePaise: 1_000,
        deliveryFeePaise: 2_500,
        merchantCommissionPaise: 1_000,
        grandTotalPaise: 23_500,
        currency: 'INR',
        ruleVersion: 'p4-v1',
      },
      expiresAt: '2026-08-15T10:00:00Z',
      etaMinutes: 35,
    });

    const quote = await fetchDeliveryQuote({
      outletId: 'outlet-1',
      addressId: 'address-1',
      lines: [{ listingId: 'listing-1', quantity: 2 }],
    }, 'access-token');

    expect(postMock).toHaveBeenCalledWith(
      '/api/v1/customer/quotes/delivery',
      {
        outletId: 'outlet-1',
        addressId: 'address-1',
        lines: [{ listingId: 'listing-1', quantity: 2 }],
        paymentMethod: 'PAY_ON_FULFILMENT',
      },
    );
    expect(JSON.stringify(postMock.mock.calls[0][1])).not.toContain('customerId');
    expect(quote.pricing.deliveryFeePaise).toBe(2_500);
    expect(quote.etaMinutes).toBe(35);
  });

  it('supports an online-payment delivery quote without client-authored amount or identity', async () => {
    postMock.mockResolvedValue({
      id: 'quote-online',
      customerId: 'server-customer',
      outletId: 'outlet-1',
      cartSignature: 'signature-online',
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
      paymentMethod: 'ONLINE_PAYMENT',
      pricing: {
        itemSubtotalPaise: 20_000,
        itemDiscountPaise: 0,
        couponDiscountPaise: 0,
        loyaltyRewardPaise: 0,
        taxPaise: 0,
        platformFeePaise: 1_000,
        deliveryFeePaise: 2_500,
        merchantCommissionPaise: 1_000,
        grandTotalPaise: 23_500,
        currency: 'INR',
        ruleVersion: 'p5-v1',
      },
      expiresAt: '2026-08-15T10:00:00Z',
      etaMinutes: 35,
    });

    await fetchDeliveryQuote({
      outletId: 'outlet-1',
      addressId: 'address-1',
      lines: [{ listingId: 'listing-1', quantity: 1 }],
      paymentMethod: 'ONLINE_PAYMENT',
    }, 'access-token');

    const body = postMock.mock.calls[0][1];
    expect(body).toMatchObject({ paymentMethod: 'ONLINE_PAYMENT' });
    expect(JSON.stringify(body)).not.toContain('customerId');
    expect(JSON.stringify(body)).not.toContain('amount');
  });

  it('fails closed when delivery quote mode or server pricing is unsupported', async () => {
    postMock.mockResolvedValue({
      id: 'quote-1',
      customerId: 'server-customer',
      outletId: 'outlet-1',
      cartSignature: 'signature',
      fulfilmentMode: 'STORE_PICKUP',
      paymentMethod: 'PAY_ON_FULFILMENT',
      pricing: {
        itemSubtotalPaise: 20_000,
        itemDiscountPaise: 0,
        couponDiscountPaise: 0,
        loyaltyRewardPaise: 0,
        taxPaise: 0,
        platformFeePaise: 1_000,
        deliveryFeePaise: 0,
        merchantCommissionPaise: 1_000,
        grandTotalPaise: 21_000,
        currency: 'INR',
        ruleVersion: 'p4-v1',
      },
      expiresAt: '2026-08-15T10:00:00Z',
      etaMinutes: 35,
    });

    await expect(fetchDeliveryQuote({
      outletId: 'outlet-1',
      addressId: 'address-1',
      lines: [{ listingId: 'listing-1', quantity: 1 }],
    }, 'access-token')).rejects.toThrow('unsupported contract');
  });

  it('requires auth and a saved address before requesting delivery', async () => {
    await expect(fetchDeliveryQuote({
      outletId: 'outlet-1',
      addressId: 'address-1',
      lines: [],
    }, null)).rejects.toThrow('Sign in');

    await expect(fetchDeliveryQuote({
      outletId: 'outlet-1',
      addressId: '',
      lines: [],
    }, 'access-token')).rejects.toThrow('saved delivery address');

    expect(postMock).not.toHaveBeenCalled();
  });

  it('reads canonical Customer-owned order tracking while apiClient owns bearer auth', async () => {
    getMock.mockResolvedValue({
      orderId: 'order/1',
      status: 'PICKED_UP',
      flowStep: 'outForDelivery',
      paymentStatus: 'PENDING_EXTERNAL_COLLECTION',
      fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
      captain: { captainId: 'captain-1', assignedAt: '2026-08-15T09:00:00Z' },
      etaMinutes: 20,
      deliveryStatus: 'PICKED_UP',
      lastLocation: { latitude: 13.63, longitude: 79.42, observedAt: '2026-08-15T09:05:00Z' },
    });

    const tracking = await fetchCustomerOrderTracking('order/1', 'access-token');

    expect(getMock).toHaveBeenCalledWith('/api/v1/customer/orders/order%2F1/tracking');
    expect(tracking.deliveryStatus).toBe('PICKED_UP');
  });
});
