import { fetchMerchantOrders, transitionOrderStatus } from './api';

describe('Merchant Orders API', () => {
  it('exports Orders functions correctly', () => {
    expect(typeof fetchMerchantOrders).toBe('function');
    expect(typeof transitionOrderStatus).toBe('function');
  });
});
