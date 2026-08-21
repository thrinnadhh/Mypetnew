import type { MerchantListing } from './api';
import {
  canWriteCatalog,
  catalogEditorTitle,
  catalogErrorMessage,
  catalogFormFromListing,
  catalogIdentitySummary,
  catalogListingCard,
  catalogOutletLabel,
  catalogPageLabel,
  catalogSearchOptions,
  catalogStatusSuccessMessage,
  createCatalogInput,
  emptyCatalogForm,
  formatPaise,
  mutableCatalogInput,
  nextCatalogStatus,
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

  it('defines deterministic lifecycle transitions and success messages', () => {
    expect(nextCatalogStatus('ACTIVE')).toBe('INACTIVE');
    expect(nextCatalogStatus('INACTIVE')).toBe('ACTIVE');
    expect(catalogStatusSuccessMessage('ACTIVE')).toBe('Listing activated.');
    expect(catalogStatusSuccessMessage('INACTIVE')).toBe('Listing deactivated.');
  });

  it('builds bounded screen search options without inventing a status filter', () => {
    expect(catalogSearchOptions('dog', 'ALL', 2)).toEqual({
      query: 'dog',
      status: undefined,
      page: 2,
      pageSize: 25,
    });
    expect(catalogSearchOptions('dog', 'INACTIVE', 0)).toEqual({
      query: 'dog',
      status: 'INACTIVE',
      page: 0,
      pageSize: 25,
    });
  });

  it('formats canonical catalog display values', () => {
    expect(formatPaise(0)).toBe('₹0.00');
    expect(formatPaise(21900)).toBe('₹219.00');
    expect(catalogIdentitySummary(listing)).toBe('PRODUCT · GTIN_13 · 4006381333931');
    expect(catalogPageLabel(0)).toBe('Page 1');
    expect(catalogPageLabel(4)).toBe('Page 5');
  });

  it('models editor and outlet labels without leaking full outlet identifiers', () => {
    expect(catalogEditorTitle(null)).toBe('Create listing');
    expect(catalogEditorTitle(listing)).toBe('Edit Dental Chew');
    expect(catalogOutletLabel('12345678-aaaa-bbbb-cccc-123456789000', null)).toBe('12345678');
    expect(catalogOutletLabel('12345678-aaaa-bbbb-cccc-123456789000', '12345678-aaaa-bbbb-cccc-123456789000')).toBe('✓ 12345678');
  });

  it('models active and inactive listing cards consistently', () => {
    expect(catalogListingCard(listing)).toEqual({
      stateLine: 'ACTIVE · v7 · COMMERCE',
      priceLine: '₹219.00 · MRP ₹250.00',
      metadataLine: 'treats',
      actionLabel: 'Deactivate',
    });
    expect(catalogListingCard({ ...listing, status: 'INACTIVE', sku: 'SKU-9' })).toEqual({
      stateLine: 'INACTIVE · v7 · COMMERCE',
      priceLine: '₹219.00 · MRP ₹250.00',
      metadataLine: 'treats · SKU SKU-9',
      actionLabel: 'Activate',
    });
  });
});
