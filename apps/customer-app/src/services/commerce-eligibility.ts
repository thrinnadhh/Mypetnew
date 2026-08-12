export interface CommerceEligibilityTarget {
  kind?: 'PRODUCT' | 'MEDICINE' | string;
  commerceMode?: 'COMMERCE' | 'VIEW_ONLY' | string;
  availableQuantity?: number;
  stockCount?: number;
  inStock?: boolean;
  pickupEnabled?: boolean;
}

export function isCommerceEligible(target: CommerceEligibilityTarget): boolean {
  if (!target) return false;
  const isProduct = target.kind === 'PRODUCT' || !target.kind;
  const isCommerce = target.commerceMode === 'COMMERCE' || !target.commerceMode;
  const quantity = target.availableQuantity ?? target.stockCount ?? 0;
  const hasStock = quantity > 0 && target.inStock !== false;
  const pickupOk = target.pickupEnabled !== false;

  return isProduct && isCommerce && hasStock && pickupOk;
}
