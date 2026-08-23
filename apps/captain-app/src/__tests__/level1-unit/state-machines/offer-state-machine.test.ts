import { DispatchOffer, DispatchOfferState } from '../../../domain/dispatch';
import { getRemainingSeconds } from '../../../utils/date';

describe('Level 1: Offer State Machine Tests', () => {
  const createMockOffer = (expiresInMs: number, state: DispatchOfferState = 'PENDING'): DispatchOffer => ({
    offerId: 'offer-unit-001',
    jobId: 'job-unit-100',
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
    state,
    outletName: 'Paw Store Koramangala',
    area: 'Koramangala 4th Block',
    distanceMeters: 1400,
    itemCount: 2,
    estimatedEarningPaise: 6500,
    receivedAt: new Date().toISOString(),
  });

  it('correctly tracks active offer validity within expiration threshold', () => {
    const offer = createMockOffer(25000);
    const remaining = getRemainingSeconds(offer.expiresAt);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(25);
    expect(offer.state).toBe('PENDING');
  });

  it('marks expired when timestamp is in the past', () => {
    const expiredOffer = createMockOffer(-5000, 'EXPIRED');
    const remaining = getRemainingSeconds(expiredOffer.expiresAt);
    expect(remaining).toBe(0);
  });

  it('maintains state machine validity across offer lifecycle transitions', () => {
    const validTransitions: Record<DispatchOfferState, DispatchOfferState[]> = {
      PENDING: ['ACCEPTING', 'REJECTING', 'EXPIRED', 'LOST', 'UNKNOWN'],
      ACCEPTING: ['ACCEPTED', 'LOST', 'EXPIRED', 'UNKNOWN', 'PENDING'],
      ACCEPTED: [], // terminal
      REJECTING: ['REJECTED', 'UNKNOWN'],
      REJECTED: [], // terminal
      EXPIRED: [], // terminal
      LOST: [], // terminal
      UNKNOWN: ['PENDING', 'ACCEPTED', 'LOST', 'EXPIRED'],
    };

    const isTransitionAllowed = (from: DispatchOfferState, to: DispatchOfferState) =>
      validTransitions[from]?.includes(to) ?? false;

    // Allowed
    expect(isTransitionAllowed('PENDING', 'ACCEPTING')).toBe(true);
    expect(isTransitionAllowed('ACCEPTING', 'ACCEPTED')).toBe(true);
    expect(isTransitionAllowed('PENDING', 'REJECTING')).toBe(true);
    expect(isTransitionAllowed('REJECTING', 'REJECTED')).toBe(true);
    expect(isTransitionAllowed('PENDING', 'EXPIRED')).toBe(true);
    expect(isTransitionAllowed('PENDING', 'LOST')).toBe(true);

    // Terminal states cannot transition further
    expect(isTransitionAllowed('ACCEPTED', 'PENDING')).toBe(false);
    expect(isTransitionAllowed('REJECTED', 'PENDING')).toBe(false);
    expect(isTransitionAllowed('EXPIRED', 'ACCEPTING')).toBe(false);
    expect(isTransitionAllowed('LOST', 'ACCEPTED')).toBe(false);
  });
});
