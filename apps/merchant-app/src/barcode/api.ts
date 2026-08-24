import { merchantApiFetch } from '../auth/session';
import type { BarcodeType, MerchantListing } from '../catalog/api';
import { normalizeMerchantBarcode } from './model';

export type BarcodeResolution = {
  barcodeType: BarcodeType;
  normalizedBarcode: string;
  listing: MerchantListing | null;
};

type ApiErrorBody = { code?: string; message?: string; error?: string };

async function apiError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  const error = new Error(body?.message ?? body?.error ?? 'Could not resolve barcode.');
  if (body?.code) error.name = body.code;
  return error;
}

export async function resolveMerchantBarcode(
  outletId: string,
  barcodeType: BarcodeType,
  rawBarcode: string,
): Promise<BarcodeResolution> {
  const barcode = normalizeMerchantBarcode(barcodeType, rawBarcode);
  const params = new URLSearchParams({ outletId, barcodeType, barcode });
  const response = await merchantApiFetch(`/api/v1/merchant/barcodes/resolve?${params.toString()}`);
  if (!response.ok) throw await apiError(response);
  return (await response.json()) as BarcodeResolution;
}
