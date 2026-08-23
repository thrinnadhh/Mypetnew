import { merchantApiFetch } from '../auth/session';

export interface MerchantLoyaltyConfirmation {
  challengeId: string;
  organizationId: string;
  outletId: string;
  customerId: string;
  status: 'CONSUMED' | 'ALREADY_CONSUMED' | 'EXPIRED';
  starAwarded: boolean;
}

export async function confirmCustomerLoyaltyChallenge(
  organizationId: string,
  outletId: string,
  challengeId: string,
  idempotencyKey: string,
): Promise<MerchantLoyaltyConfirmation> {
  const response = await merchantApiFetch('/api/v1/merchant/loyalty/confirm-challenge', {
    method: 'POST',
    headers: {
      'Idempotency-Key': idempotencyKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      organizationId,
      outletId,
      challengeId,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    throw new Error(errorBody?.message ?? `Loyalty confirmation failed: ${response.status}`);
  }

  return response.json();
}
