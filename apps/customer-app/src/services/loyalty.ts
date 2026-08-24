import { apiClient } from './api-client';

export interface LoyaltyProgressDto {
  providerId: string;
  starBalance: number;
  targetStars: number;
  cycleCount: number;
  totalStarsEarned: number;
  welcomeStarClaimed: boolean;
  rewardAmount: number;
  isProgramActive: boolean;
  minOrderValue: number;
}

export interface LoyaltyRewardDto {
  rewardId: string;
  providerId: string;
  rewardAmount: number;
  code: string;
  status: 'ISSUED' | 'RESERVED' | 'REDEEMED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
}

export interface LoyaltyLedgerEntryDto {
  entryId: string;
  customerId: string;
  providerId: string;
  deltaStars: number;
  entryType: 'WELCOME_STAR' | 'PURCHASE_STAR' | 'CYCLE_ROLLOVER' | 'STAR_REVERSAL' | 'ADMIN_ADJUSTMENT';
  referenceId?: string | null;
  note?: string | null;
  createdAt: string;
}

export interface PromotionDto {
  promotionId: string;
  providerId?: string | null;
  code: string;
  discountType: 'PERCENTAGE' | 'FLAT';
  discountValue: number | string;
  maxDiscountAmount?: number | string | null;
  minOrderValue?: number | string | null;
  validFrom: string;
  validUntil: string;
  applicableCategory?: string | null;
  isActive: boolean;
}

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

export async function fetchLoyaltyProgress(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  return apiClient.get<LoyaltyProgressDto>(
    `/api/v1/loyalty/progress?providerId=${encodeURIComponent(providerId)}`,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not fetch loyalty progress' },
  );
}

export async function claimWelcomeStar(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  return apiClient.post<LoyaltyProgressDto>(
    `/api/v1/loyalty/welcome-star/claim?providerId=${encodeURIComponent(providerId)}`,
    undefined,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not claim welcome star' },
  );
}

export async function fetchCustomerWallet(accessToken: string): Promise<LoyaltyRewardDto[]> {
  return apiClient.get<LoyaltyRewardDto[]>(
    '/api/v1/loyalty/wallet',
    undefined,
    { authToken: accessToken, errorFallback: 'Could not fetch loyalty wallet' },
  );
}

export async function fetchActivePromotions(accessToken: string): Promise<PromotionDto[]> {
  const promotions = await apiClient.get<PromotionDto[]>(
    '/api/v1/payments/promotions',
    undefined,
    { authToken: accessToken, errorFallback: 'Could not fetch active promotions' },
  );
  const now = Date.now();
  return promotions
    .filter((promotion) => {
      const validFrom = Date.parse(promotion.validFrom);
      const validUntil = Date.parse(promotion.validUntil);
      return promotion.isActive &&
        Number.isFinite(validFrom) &&
        Number.isFinite(validUntil) &&
        validFrom <= now &&
        validUntil >= now;
    })
    .sort((left, right) => Date.parse(left.validUntil) - Date.parse(right.validUntil));
}

export async function fetchLoyaltyLedger(
  accessToken: string,
  providerId?: string,
): Promise<LoyaltyLedgerEntryDto[]> {
  const path = providerId
    ? `/api/v1/loyalty/ledger?providerId=${encodeURIComponent(providerId)}`
    : '/api/v1/loyalty/ledger';
  return apiClient.get<LoyaltyLedgerEntryDto[]>(
    path,
    undefined,
    { authToken: accessToken, errorFallback: 'Could not fetch loyalty ledger' },
  );
}