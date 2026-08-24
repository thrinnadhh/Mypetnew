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

function retainLegacyTokenParameter(_accessToken: string): void {
  // AuthContext owns the canonical ApiClient token. Keep the legacy parameter only
  // while existing screens still pass it explicitly.
}

export async function fetchCustomerLoyaltyBalance(
  organizationId: string,
  accessToken: string,
): Promise<CustomerLoyaltyBalanceResponse> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<CustomerLoyaltyBalanceResponse>(
    `/api/v2/customer/loyalty/${encodeURIComponent(organizationId)}`,
  );
}

export async function fetchLoyaltyProgress(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<LoyaltyProgressDto>(
    `/api/v1/loyalty/progress?providerId=${encodeURIComponent(providerId)}`,
  );
}

export async function claimWelcomeStar(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.post<LoyaltyProgressDto>(
    `/api/v1/loyalty/welcome-star/claim?providerId=${encodeURIComponent(providerId)}`,
  );
}

export async function fetchCustomerWallet(accessToken: string): Promise<LoyaltyRewardDto[]> {
  retainLegacyTokenParameter(accessToken);
  return apiClient.get<LoyaltyRewardDto[]>('/api/v1/loyalty/wallet');
}

export async function fetchActivePromotions(accessToken: string): Promise<PromotionDto[]> {
  retainLegacyTokenParameter(accessToken);
  const promotions = await apiClient.get<PromotionDto[]>('/api/v1/payments/promotions');
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
  retainLegacyTokenParameter(accessToken);
  const path = providerId
    ? `/api/v1/loyalty/ledger?providerId=${encodeURIComponent(providerId)}`
    : '/api/v1/loyalty/ledger';
  return apiClient.get<LoyaltyLedgerEntryDto[]>(path);
}
