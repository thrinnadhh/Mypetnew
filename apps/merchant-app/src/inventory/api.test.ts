import { fetchMerchantListings, receiveStock } from './api';

describe('Merchant Inventory API', () => {
  it('exports Inventory functions correctly', () => {
    expect(typeof fetchMerchantListings).toBe('function');
    expect(typeof receiveStock).toBe('function');
  });
});
