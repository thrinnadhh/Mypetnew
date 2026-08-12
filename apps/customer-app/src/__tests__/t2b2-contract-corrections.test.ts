import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isCommerceEligible } from '../services/commerce-eligibility';
import {
  fetchAllPublicOutlets,
  type PublicOutletSummary,
  type PageResponse,
} from '../services/customer-catalog';

jest.mock('../services/api-client', () => ({
  apiClient: {
    get: jest.fn(),
  },
}));

import { apiClient } from '../services/api-client';

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('T2B2 Contract Corrections', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('isCommerceEligible (Fail Closed Rule)', () => {
    it('returns false when kind is missing', () => {
      expect(
        isCommerceEligible({
          commerceMode: 'COMMERCE',
          availableQuantity: 10,
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false when commerceMode is missing', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          availableQuantity: 10,
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false when availableQuantity is missing', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false when pickupEnabled is missing', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          availableQuantity: 10,
        }),
      ).toBe(false);
    });

    it('returns false for MEDICINE kind', () => {
      expect(
        isCommerceEligible({
          kind: 'MEDICINE',
          commerceMode: 'COMMERCE',
          availableQuantity: 10,
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false for VIEW_ONLY commerceMode', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'VIEW_ONLY',
          availableQuantity: 10,
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false when availableQuantity is 0', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          availableQuantity: 0,
          pickupEnabled: true,
        }),
      ).toBe(false);
    });

    it('returns false when pickupEnabled is false', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          availableQuantity: 10,
          pickupEnabled: false,
        }),
      ).toBe(false);
    });

    it('returns true ONLY when PRODUCT + COMMERCE + quantity > 0 + pickupEnabled = true', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          availableQuantity: 5,
          pickupEnabled: true,
        }),
      ).toBe(true);
    });
  });

  describe('CartContext.revalidateCart Enforcement', () => {
    it('uses isCommerceEligible to remove ineligible items during cart revalidation', () => {
      const cartContext = source('src/context/CartContext.tsx');
      expect(cartContext).toMatch(/revalidateCart/);
      expect(cartContext).toMatch(/if \(!isCommerceEligible\(item\.product\)\)/);
    });
  });

  describe('fetchAllPublicOutlets Multi-page Pagination', () => {
    it('aggregates across page 0 (hasNext=true) and page 1 (hasNext=false)', async () => {
      const page0: PageResponse<PublicOutletSummary> = {
        items: [
          {
            id: 'outlet-1',
            organizationId: 'org-1',
            name: 'Outlet One',
            capabilities: ['PRODUCT_STORE'],
            pickupEnabled: true,
          },
        ],
        page: 0,
        pageSize: 1,
        hasNext: true,
      };

      const page1: PageResponse<PublicOutletSummary> = {
        items: [
          {
            id: 'outlet-2',
            organizationId: 'org-1',
            name: 'Outlet Two',
            capabilities: ['PRODUCT_STORE'],
            pickupEnabled: true,
          },
        ],
        page: 1,
        pageSize: 1,
        hasNext: false,
      };

      mockedApiClient.get
        .mockResolvedValueOnce(page0)
        .mockResolvedValueOnce(page1);

      const outlets = await fetchAllPublicOutlets({ capability: 'PRODUCT_STORE' });

      expect(outlets).toHaveLength(2);
      expect(outlets[0].name).toBe('Outlet One');
      expect(outlets[1].name).toBe('Outlet Two');
      expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('Live Image & Brand Fallback Rules', () => {
    it('disables demo image fallbacks in live mode for CategoryTemplate and ProviderProfileTemplate', () => {
      const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
      const providerProfileTemplate = source('src/components/commerce/ProviderProfileTemplate.tsx');
      const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

      expect(categoryTemplate).toMatch(/if \(!appConfig\.allowDemoMode\)\s*{\s*return undefined;/);
      expect(providerProfileTemplate).toMatch(/if \(!appConfig\.allowDemoMode\)\s*{\s*return undefined;/);
      expect(resilientImage).toMatch(/appConfig\.allowDemoMode \? DEMO_MEDIA\.store : undefined/);
    });

    it('does not render providerName in brand position when brand is absent', () => {
      const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
      expect(categoryTemplate).not.toMatch(/item\.brand \|\| item\.providerName/);
      expect(categoryTemplate).toMatch(/item\.brand \?/);
    });
  });

  describe('Product Detail Pickup Availability Truthfulness', () => {
    it('derives pickup availability strictly from pickupEnabled boolean and never from address absence', () => {
      const productDetail = source('src/app/commerce/product-detail.tsx');
      expect(productDetail).toMatch(/product\.sellerInfo\?\.address \?\s*\(\s*<ThemedText[^>]*>\{product\.sellerInfo\.address\}<\/ThemedText>\s*\)\s*:\s*null/);
      expect(productDetail).toMatch(/product\.pickupEnabled \? 'Store pickup available' : 'Pickup unavailable'/);
    });
  });
});
