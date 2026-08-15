import { fetchDeliveryContact } from '@/services/customer-profile';
import { createCustomerOrder, fetchCustomerOrders } from '@/services/customer-orders';

const mockFetchDeliveryContact = fetchDeliveryContact as jest.MockedFunction<typeof fetchDeliveryContact>;

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('customer order production edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('blocks order creation before network submission when the address has no delivery contact', async () => {
    mockFetchDeliveryContact.mockResolvedValueOnce(null);

    await expect(
      createCustomerOrder(
        {
          customerId: 'customer-1',
          providerId: 'provider-1',
          deliveryAddressId: 'address-1',
          items: [{ offeringId: 'food-1', quantity: 1 }],
          paymentMethod: 'COD',
          quoteToken: 'quote-1',
        },
        'access-token',
      ),
    ).rejects.toThrow('Add a delivery contact number');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('falls back to a stable store label when provider-name lookup is unavailable', async () => {
    const mockedFetch = global.fetch as jest.MockedFunction<typeof fetch>;
    mockedFetch
      .mockResolvedValueOnce(
        response([
          {
            orderId: 'order-1',
            providerId: 'provider-12345678',
            status: 'PLACED',
            flowStep: 'placed',
            totalAmount: 250,
            placedAt: '2026-08-08T10:00:00Z',
            items: ['Pet Food'],
          },
        ]),
      )
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const orders = await fetchCustomerOrders('customer-1', 'access-token');

    expect(orders).toHaveLength(1);
    expect(orders[0].providerName).toBe('Store provider');
  });
});
