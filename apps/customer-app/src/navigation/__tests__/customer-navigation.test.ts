import { CUSTOMER_TABS, NESTED_ROUTE_FOUNDATIONS } from '@/navigation/customer-navigation';

describe('customer navigation contract', () => {
  it('exposes exactly the four primary tabs', () => {
    expect(CUSTOMER_TABS.map((tab) => tab.name)).toEqual(['home', 'search', 'orders', 'profile']);
  });

  it('keeps marketplace and service discovery as nested customer routes', () => {
    expect(NESTED_ROUTE_FOUNDATIONS).toEqual(expect.arrayContaining([
      '/stores',
      '/shop/[id]',
      '/groom',
      '/groomer/[id]',
      '/vet',
      '/vet/[slug]',
      '/checkout',
      '/providers/[type]/[id]',
    ]));
  });
});
