import { CUSTOMER_TABS, NESTED_ROUTE_FOUNDATIONS } from '@/navigation/customer-navigation';

describe('customer navigation contract', () => {
  it('exposes exactly the four S10 tabs', () => expect(CUSTOMER_TABS.map((tab) => tab.name)).toEqual(['home', 'search', 'orders', 'profile']));
  it('keeps commerce and service details nested', () => {
    expect(NESTED_ROUTE_FOUNDATIONS).toContain('/checkout');
    expect(NESTED_ROUTE_FOUNDATIONS).toContain('/providers/[type]/[id]');
  });
});
