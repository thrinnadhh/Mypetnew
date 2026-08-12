import type { CartItem } from '@/context/CartContext';
import type { ReorderValidationResult } from '@/services/customer-orders';
import { fetchCommerceProduct } from '@/services/customer-catalog';

export async function buildCartFromRevalidation(
  result: ReorderValidationResult,
): Promise<CartItem[]> {
  if (!result.canReorder || !result.isProviderServiceable) {
    throw new Error('The provider or one of the selected items is currently unavailable.');
  }

  const availableItems = result.items.filter((item) => item.isAvailable && item.quantity > 0);
  if (availableItems.length !== result.items.length) {
    throw new Error('One or more items are unavailable. Review the order before continuing.');
  }

  const products = await Promise.all(
    availableItems.map((item) => fetchCommerceProduct(item.offeringId)),
  );

  return products.map((product, index) => {
    if (product.providerId !== result.providerId) {
      throw new Error('Revalidated item belongs to a different provider.');
    }
    const variant = product.variants[0];
    if (!variant?.inStock) {
      throw new Error(`${product.name} is no longer in stock.`);
    }
    const requestedQuantity = availableItems[index].quantity;
    if (requestedQuantity > variant.stockCount) {
      throw new Error(`Only ${variant.stockCount} units of ${product.name} are available.`);
    }
    return {
      product,
      selectedVariant: variant,
      quantity: requestedQuantity,
      unitPrice: variant.price,
    };
  });
}
