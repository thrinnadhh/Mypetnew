import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeCartItemsForRevalidation } from '../context/CartContext';
import { isCommerceEligible } from '../services/commerce-eligibility';
import {
  fetchAllCatalogItems,
  fetchAllPublicOutlets,
  type PublicOutletSummary,
  type PublicListingSummary,
  type PageResponse,
  type CommerceProduct,
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

function makeProduct(overrides: Partial<CommerceProduct> = {}): CommerceProduct {
  return {
    id: 'prod-1',
    name: 'Sample Product',
    category: 'food',
    price: 100,
    mrpPaise: 10000,
    sellingPricePaise: 10000,
    inStock: true,
    stockCount: 10,
    availableQuantity: 10,
    imageUrl: 'https://example.com/item.jpg',
    galleryImages: ['https://example.com/item.jpg'],
    createdAt: '2026-08-12T00:00:00Z',
    providerId: 'outlet-1',
    providerName: 'Sample Outlet',
    kind: 'PRODUCT',
    commerceMode: 'COMMERCE',
    pickupEnabled: true,
    variants: [
      {
        id: 'prod-1',
        name: 'Sample Product',
        price: 100,
        inStock: true,
        stockCount: 10,
      },
    ],
    ...overrides,
  };
}

describe('T2B2 Contract Corrections', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('isCommerceEligible (Strict Fail-Closed Rule)', () => {
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

    it('returns false when availableQuantity is missing even if stockCount > 0', () => {
      expect(
        isCommerceEligible({
          kind: 'PRODUCT',
          commerceMode: 'COMMERCE',
          availableQuantity: undefined,
          stockCount: 10,
          pickupEnabled: true,
          inStock: true,
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

  describe('sanitizeCartItemsForRevalidation Behavioral Tests', () => {
    it('retains valid PRODUCT + COMMERCE + availableQuantity > 0 + pickupEnabled = true lines', () => {
      const product = makeProduct({ availableQuantity: 5 });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 2,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(true);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(2);
    });

    it('removes VIEW_ONLY items', () => {
      const product = makeProduct({ commerceMode: 'VIEW_ONLY' });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 1,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('removes MEDICINE items', () => {
      const product = makeProduct({ kind: 'MEDICINE' });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 1,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('removes pickupEnabled = false items', () => {
      const product = makeProduct({ pickupEnabled: false });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 1,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('removes availableQuantity = 0 items', () => {
      const product = makeProduct({ availableQuantity: 0 });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 1,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('removes missing availableQuantity items even if stockCount > 0', () => {
      const product = makeProduct({ availableQuantity: undefined, stockCount: 10 });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 1,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(0);
    });

    it('clamps item quantity when stored quantity exceeds available stock', () => {
      const product = makeProduct({ availableQuantity: 3 });
      const cartItem = {
        product,
        selectedVariant: product.variants[0],
        quantity: 10,
        unitPrice: 100,
      };

      const result = sanitizeCartItemsForRevalidation([cartItem]);
      expect(result.valid).toBe(false);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(3);
    });
  });

  describe('fetchAllCatalogItems Multi-page Catalog Search Pagination', () => {
    it('aggregates across page 0 (hasNext=true) and page 1 (hasNext=false) for live search', async () => {
      const page0: PageResponse<PublicListingSummary> = {
        items: [
          {
            id: 'prod-1',
            organizationId: 'org-1',
            outletId: 'outlet-1',
            outletName: 'Outlet One',
            name: 'Dog Food 1',
            kind: 'PRODUCT',
            category: 'food',
            mrpPaise: 50000,
            sellingPricePaise: 50000,
            currency: 'INR',
            commerceMode: 'COMMERCE',
            availableQuantity: 10,
            pickupEnabled: true,
            createdAt: '2026-08-12T00:00:00Z',
          },
        ],
        page: 0,
        pageSize: 1,
        hasNext: true,
      };

      const page1: PageResponse<PublicListingSummary> = {
        items: [
          {
            id: 'prod-2',
            organizationId: 'org-1',
            outletId: 'outlet-1',
            outletName: 'Outlet One',
            name: 'Dog Food 2',
            kind: 'PRODUCT',
            category: 'food',
            mrpPaise: 60000,
            sellingPricePaise: 60000,
            currency: 'INR',
            commerceMode: 'COMMERCE',
            availableQuantity: 5,
            pickupEnabled: true,
            createdAt: '2026-08-12T00:00:00Z',
          },
        ],
        page: 1,
        pageSize: 1,
        hasNext: false,
      };

      mockedApiClient.get
        .mockResolvedValueOnce(page0)
        .mockResolvedValueOnce(page1);

      const items = await fetchAllCatalogItems({ q: 'Dog', kind: 'PRODUCT', pageSize: 1 });

      expect(items).toHaveLength(2);
      expect(items[0].name).toBe('Dog Food 1');
      expect(items[1].name).toBe('Dog Food 2');
      expect(mockedApiClient.get).toHaveBeenCalledTimes(2);
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

  describe('Live Home Filter Removal', () => {
    it('does not expose Dry Food, Wet Food, Puppy, Adult, Senior filter controls in live mode', () => {
      const homeScreen = source('src/screens/home-screen.tsx');
      expect(homeScreen).toMatch(/appConfig\.allowDemoMode \?\s*\(\s*<ScrollView[^>]*contentContainerStyle=\{styles\.filterRow\}/);
      expect(homeScreen).not.toMatch(/const activeFilters/);
    });
  });

  describe('Live Image & Brand Fallback Rules', () => {
    it('disables demo image fallbacks in live mode for CategoryTemplate and ProviderProfileTemplate', () => {
      const categoryTemplate = source('src/components/commerce/CategoryTemplate.tsx');
      const providerProfileTemplate = source('src/components/commerce/ProviderProfileTemplate.tsx');
      const resilientImage = source('src/components/ui/resilient-remote-image.tsx');

      expect(categoryTemplate).toMatch(/if \(!appConfig\.allowDemoMode\)\s*{\s*return undefined;/);
      expect(providerProfileTemplate).toMatch(/if \(!appConfig\.allowDemoMode\)\s*{\s*return undefined;/);
      expect(resilientImage).toMatch(/effectiveFallback = appConfig\.allowDemoMode/);
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
