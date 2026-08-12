import { appConfig } from '@/utils/app-config';

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

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

async function apiError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
  return new Error(body?.message || body?.error || fallback);
}

export async function fetchLoyaltyProgress(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/loyalty/progress?providerId=${encodeURIComponent(providerId)}`,
    { headers: authHeaders(accessToken) },
  );
  if (!response.ok) throw await apiError(response, 'Could not fetch loyalty progress');
  return (await response.json()) as LoyaltyProgressDto;
}

export async function claimWelcomeStar(
  providerId: string,
  accessToken: string,
): Promise<LoyaltyProgressDto> {
  const response = await fetch(
    `${appConfig.apiBaseUrl}/api/v1/loyalty/welcome-star/claim?providerId=${encodeURIComponent(providerId)}`,
    { method: 'POST', headers: authHeaders(accessToken) },
  );
  if (!response.ok) throw await apiError(response, 'Could not claim welcome star');
  return (await response.json()) as LoyaltyProgressDto;
}

export async function fetchCustomerWallet(
  accessToken: string,
): Promise<LoyaltyRewardDto[]> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/loyalty/wallet`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) throw await apiError(response, 'Could not fetch loyalty wallet');
  return (await response.json()) as LoyaltyRewardDto[];
}

export async function fetchActivePromotions(
  accessToken: string,
): Promise<PromotionDto[]> {
  const response = await fetch(`${appConfig.apiBaseUrl}/api/v1/payments/promotions`, {
    headers: authHeaders(accessToken),
  });
  if (!response.ok) throw await apiError(response, 'Could not fetch active promotions');

  const now = Date.now();
  const promotions = (await response.json()) as PromotionDto[];
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
  const url = providerId
    ? `${appConfig.apiBaseUrl}/api/v1/loyalty/ledger?providerId=${encodeURIComponent(providerId)}`
    : `${appConfig.apiBaseUrl}/api/v1/loyalty/ledger`;
  const response = await fetch(url, { headers: authHeaders(accessToken) });
  if (!response.ok) throw await apiError(response, 'Could not fetch loyalty ledger history');
  return (await response.json()) as LoyaltyLedgerEntryDto[];
}
