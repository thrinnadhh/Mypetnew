import { parseActiveDelivery } from '../../api/deliveries';

describe('active delivery restart contract', () => {
  const payload = {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    orderId: '550e8400-e29b-41d4-a716-446655440001',
    orderReference: 'MP-ABC123',
    outletId: '550e8400-e29b-41d4-a716-446655440002',
    outletName: 'MyPet Store',
    originLatitude: 13.6287,
    originLongitude: 79.4191,
    deliveryAddress: {
      addressId: '550e8400-e29b-41d4-a716-446655440003',
      recipientName: 'Aditi Rao',
      phoneNumber: '+919876543210',
      line1: '100 Main Road',
      line2: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560034',
    },
    state: 'ASSIGNED',
    itemCount: 2,
    assignedAt: '2026-08-24T10:00:00Z',
    pickedUpAt: null,
    deliveredAt: null,
    failureReason: null,
  };

  it('maps the server-owned active projection required after process restart', () => {
    expect(parseActiveDelivery(payload)).toMatchObject({
      jobId: payload.jobId,
      state: 'ASSIGNED',
      outletName: 'MyPet Store',
      deliveryAddress: { recipientName: 'Aditi Rao' },
      originLatitude: 13.6287,
    });
  });

  it('fails closed instead of casting a partial reconciliation DTO as a delivery', () => {
    try {
      parseActiveDelivery({
        jobId: payload.jobId,
        orderId: payload.orderId,
        outletId: payload.outletId,
        status: 'ASSIGNED',
      });
      throw new Error('Expected partial payload to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ code: 'MALFORMED_ACTIVE_DELIVERY' });
    }
  });
});
