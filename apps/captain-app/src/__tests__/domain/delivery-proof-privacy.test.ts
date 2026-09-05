import { sanitizeDeliveryProof } from '../../domain/delivery';

describe('delivery proof privacy', () => {
  it('removes a PIN before proof metadata is retained in application state', () => {
    const proof = sanitizeDeliveryProof({
      type: 'PIN',
      pinCode: '123456',
      notes: 'customer verified',
      capturedAt: '2026-09-05T01:00:00Z',
    });

    expect(proof).toEqual({
      type: 'PIN',
      notes: 'customer verified',
      capturedAt: '2026-09-05T01:00:00Z',
    });
    expect(proof).not.toHaveProperty('pinCode');
  });

  it('preserves non-secret proof metadata', () => {
    const proof = sanitizeDeliveryProof({
      type: 'PHOTO',
      photoUri: 'file:///proof.jpg',
      capturedAt: '2026-09-05T01:00:00Z',
    });

    expect(proof).toEqual({
      type: 'PHOTO',
      photoUri: 'file:///proof.jpg',
      capturedAt: '2026-09-05T01:00:00Z',
    });
  });
});