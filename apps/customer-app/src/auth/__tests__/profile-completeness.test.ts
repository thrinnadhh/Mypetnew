import { isProfileComplete, missingProfileRequirements } from '@/auth/profile-completeness';

describe('profile completeness', () => {
  it('requires only display name after first verification', () => {
    expect(missingProfileRequirements({ displayName: '', verifiedPhone: null, hasDeliveryAddress: false }, 'POST_AUTH')).toEqual(['DISPLAY_NAME']);
  });
  it('requires verified mobile and address for checkout', () => {
    expect(missingProfileRequirements({ displayName: 'Trinadh', verifiedPhone: null, hasDeliveryAddress: false }, 'CHECKOUT')).toEqual(['VERIFIED_PHONE', 'DELIVERY_ADDRESS']);
  });
  it('does not require optional email', () => {
    expect(isProfileComplete({ displayName: 'Trinadh', verifiedPhone: '+919999999999', email: null, hasDeliveryAddress: true }, 'CHECKOUT')).toBe(true);
  });
});
