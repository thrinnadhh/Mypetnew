import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { router } from 'expo-router';
import DeliveryOfferModal from '../../app/delivery/offer';
import { useCaptainStore } from '../../state/captain-store';
import { useDeliveryStore } from '../../state/delivery-store';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn() },
}));

jest.mock('../../state/captain-store', () => ({
  useCaptainStore: jest.fn(),
}));

jest.mock('../../state/delivery-store', () => ({
  useDeliveryStore: jest.fn(),
}));

jest.mock('../../components/DeliveryOfferCard', () => ({
  DeliveryOfferCard: (props: any) => require('react').createElement('DeliveryOfferCard', props),
}));

const offer = {
  offerId: '550e8400-e29b-41d4-a716-446655440000',
  jobId: '550e8400-e29b-41d4-a716-446655440001',
  expiresAt: '2026-09-05T12:00:00Z',
  state: 'PENDING' as const,
  outletName: 'MyPet Store',
  receivedAt: '2026-09-05T11:55:00Z',
};

describe('delivery offer rejection authority', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useCaptainStore as unknown as jest.Mock).mockReturnValue({ isNetworkConnected: true });
  });

  it('does not navigate away when rejection is pending or unknown', async () => {
    const rejectOffer = jest.fn().mockResolvedValue({
      outcome: 'PENDING',
      commandId: 'command-1',
      idempotencyKey: 'reject-1',
    });
    (useDeliveryStore as unknown as jest.Mock).mockReturnValue({
      activeOffer: offer,
      acceptOffer: jest.fn(),
      rejectOffer,
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<DeliveryOfferModal />);
    });
    const card = renderer.root.findByType('DeliveryOfferCard' as any);

    await act(async () => {
      await card.props.onReject();
    });

    expect(rejectOffer).toHaveBeenCalledWith(offer.offerId);
    expect(router.back).not.toHaveBeenCalled();
    expect(renderer.root.findByType('DeliveryOfferCard' as any)).toBeTruthy();
    renderer.unmount();
  });

  it('navigates back only after authoritative rejection acknowledgement', async () => {
    const rejectOffer = jest.fn().mockResolvedValue({
      outcome: 'ACKNOWLEDGED',
      commandId: 'command-2',
      idempotencyKey: 'reject-2',
      data: {},
    });
    (useDeliveryStore as unknown as jest.Mock).mockReturnValue({
      activeOffer: offer,
      acceptOffer: jest.fn(),
      rejectOffer,
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<DeliveryOfferModal />);
    });
    const card = renderer.root.findByType('DeliveryOfferCard' as any);

    await act(async () => {
      await card.props.onReject();
    });

    expect(router.back).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });
});