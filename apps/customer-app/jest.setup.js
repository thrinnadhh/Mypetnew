jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Order-service tests exercise order mapping and error handling independently from
// the profile/contact endpoint. Dedicated customer-profile tests still use
// jest.requireActual() to cover the real contact API contract.
jest.mock('@/services/customer-profile', () => {
  const actual = jest.requireActual('@/services/customer-profile');
  return {
    ...actual,
    fetchDeliveryContact: jest.fn().mockResolvedValue({
      addressId: 'test-address',
      phoneNumber: '+919876543210',
    }),
  };
});
