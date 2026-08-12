export interface CommerceEligibilityTarget {
  kind?: string | null;
  commerceMode?: string | null;
  availableQuantity?: number | null;
  stockCount?: number | null;
  pickupEnabled?: boolean | null;
  inStock?: boolean | null;
}

export function isCommerceEligible(
  target?: CommerceEligibilityTarget | null,
): boolean {
  if (!target) return false;

  const isProduct = target.kind === 'PRODUCT';
  const isCommerce = target.commerceMode === 'COMMERCE';
  const qty = target.availableQuantity;
  const hasQuantity = typeof qty === 'number' && Number.isFinite(qty) && qty > 0;
  const pickupOk = target.pickupEnabled === true;
  const stockOk = target.inStock !== false;

  return isProduct && isCommerce && hasQuantity && pickupOk && stockOk;
}
