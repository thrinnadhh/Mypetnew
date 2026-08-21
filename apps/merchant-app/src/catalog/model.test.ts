import type { MerchantListing } from './api';
import {
  canWriteCatalog,
  catalogErrorMessage,
  catalogFormFromListing,
  createCatalogInput,
  emptyCatalogForm,
  mutableCatalogInput,
  parseCatalogPaise,
} from './model';

const listing: MerchantListing = {
  id: 'listing-1',
  organizationId: 'org-1',
  outletId: 'outlet-1',
  barcodeType: 'GTIN_13',
  normalizedBarcode: '4006381333931',
  name: 'Dental Chew',
  kind: 'PRODUCT',
  commerceMode: 'COMMERCE',
  mrpPaise: 25000,
  sellingPricePaise: 21900,
  category: 'treats',
  brand: null,
  description: 'Daily chew',
  petType: 'dog',
  lifeStage: null,
  packLabel: '30 pack',
  sku: null,
  imageUrls: [],
  status: 'ACTIVE',
  version: 7,
  createdAt: '2026-08-21T00:00:00Z',
  updatedAt: '2026-08-21T01:00:00Z',
};

describe('M2 Merchant catalog view model', () => {
  it('provides a safe empty create form', () => {
    expect(emptyCatalogForm()).toEqual({
      barcodeType: 'INTERNAL',
      barcode: '',
      kind: 'PRODUCT',
      name: '',
      mrpPaise: '',
      sellingPricePaise: '',
      category: 'other',
      brand: '',
      description: '',
      petType: '',
      lifeStage: '',
      packLabel: '',
      sku: '',
    });
    expect(emptyCatalogForm()).not.toBe(emptyCatalogForm());
  });

  it.each([
    ['0', 0],
    [' 19900 ', 19900],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ])('parses integer paise %s without floating-point currency', (input, expected) => {
    expect(parseCatalogPaise(input, 'Price')).toBe(expected);
  });

  it.each(['', '12.50', '-1', '₹100', 'abc'])('rejects malformed paise value %s', (input) => {
    expect(() => parseCatalogPaise(input, 'Selling price')).toThrow('Selling price must be a whole number of paise.');
  });

  it('rejects an integer outside JavaScript safe range', () => {
    expect(() => parseCatalogPaise('9007199254740992', 'MRP')).toThrow('MRP is outside the supported range.');
  });

  it('requires current OWNER or CATALOG_WRITE for editable state', () => {
    expect(canWriteCatalog({}, null)).toBe(false);
    expect(canWriteCatalog({}, 'outlet-1')).toBe(false);
    expect(canWriteCatalog({ 'outlet-1': ['ORDER_FULFIL'] }, 'outlet-1')).toBe(false);
    expect(canWriteCatalog({ 'outlet-1': ['CATALOG_WRITE'] }, 'outlet-1')).toBe(true);
    expect(canWriteCatalog({ 'outlet-1': ['OWNER'] }, 'outlet-1')).toBe(true);
  });

  it('maps canonical server failures to actionable Merchant messages', () => {
    const stale = new Error('stale');
    stale.name = 'CATALOG_VERSION_CONFLICT';
    expect(catalogErrorMessage(stale)).toContain('latest version was reloaded');

    const duplicate = new Error('duplicate');
    duplicate.name = 'CATALOG_DUPLICATE';
    expect(catalogErrorMessage(duplicate)).toContain('barcode already identifies');

    for (const code of ['MERCHANT_PERMISSION_REQUIRED', 'RESOURCE_NOT_FOUND']) {
      const denied = new Error('denied');
      denied.name = code;
      expect(catalogErrorMessage(denied)).toContain('current Merchant access');
    }

    expect(catalogErrorMessage(new Error('Specific validation message'))).toBe('Specific validation message');
    expect(catalogErrorMessage({ code: 'UNKNOWN' })).toBe('The catalog action could not be completed.');
  });

  it('round-trips canonical listing metadata into editable form fields', () => {
    expect(catalogFormFromListing(listing)).toEqual({
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      kind: 'PRODUCT',
      name: 'Dental Chew',
      mrpPaise: '25000',
      sellingPricePaise: '21900',
      category: 'treats',
      brand: '',
      description: 'Daily chew',
      petType: 'dog',
      lifeStage: '',
      packLabel: '30 pack',
      sku: '',
    });
  });

  it('builds mutable API input and normalizes blank optional fields to null', () => {
    const form = catalogFormFromListing(listing);
    expect(mutableCatalogInput(form)).toEqual({
      name: 'Dental Chew',
      mrpPaise: 25000,
      sellingPricePaise: 21900,
      category: 'treats',
      brand: null,
      description: 'Daily chew',
      petType: 'dog',
      lifeStage: null,
      packLabel: '30 pack',
      sku: null,
    });
  });

  it('adds immutable identity fields only for create requests', () => {
    const form = {
      ...emptyCatalogForm(),
      barcodeType: 'GTIN_13' as const,
      barcode: '4006381333931',
      kind: 'MEDICINE' as const,
      name: 'Medicine',
      mrpPaise: '10000',
      sellingPricePaise: '9000',
      category: 'medicine',
      brand: 'Brand',
      sku: 'SKU-1',
    };
    expect(createCatalogInput(form)).toEqual({
      barcodeType: 'GTIN_13',
      barcode: '4006381333931',
      kind: 'MEDICINE',
      name: 'Medicine',
      mrpPaise: 10000,
      sellingPricePaise: 9000,
      category: 'medicine',
      brand: 'Brand',
      description: null,
      petType: null,
      lifeStage: null,
      packLabel: null,
      sku: 'SKU-1',
    });
  });
});
