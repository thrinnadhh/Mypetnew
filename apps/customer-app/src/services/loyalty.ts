import { apiClient } from './api-client';

export type CustomerLoyaltyRewardStatus = 'ISSUED' | 'RESERVED' | 'REDEEMED' | 'REVOKED' | 'EXPIRED';

export interface CustomerLoyaltyRewardResponse {
  rewardId: string;
  valuePaise: number;
  status: CustomerLoyaltyRewardStatus;
  issuedAt: string;
  expiresAt: string;
}

export interface CustomerLoyaltyBalanceResponse {
  organizationId: string;
  availableStars: number;
  rewards: CustomerLoyaltyRewardResponse[];
}

export async function fetchCustomerLoyaltyBalance(
  organizationId: string,
  accessToken: string,
): Promise<CustomerLoyaltyBalanceResponse> {
  return apiClient.get<CustomerLoyaltyBalanceResponse>(
    `/api/v2/customer/loyalty/${encodeURIComponent(organizationId)}`,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not fetch loyalty balance' },
  );
}
