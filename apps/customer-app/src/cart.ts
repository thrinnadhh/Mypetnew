export interface CartLine {
  readonly listingId: string
  readonly quantity: number
}

export interface CustomerCart {
  readonly outletId: string | null
  readonly lines: readonly CartLine[]
}

export type AddCartLineResult =
  | { readonly kind: 'updated'; readonly cart: CustomerCart }
  | { readonly kind: 'outlet-conflict'; readonly currentOutletId: string; readonly requestedOutletId: string }

export function createEmptyCart(): CustomerCart {
  return { outletId: null, lines: [] }
}

export function addCartLine(
  cart: CustomerCart,
  input: { readonly outletId: string; readonly listingId: string; readonly quantity: number }
): AddCartLineResult {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0 || input.quantity > 100) {
    throw new Error('Quantity must be an integer between 1 and 100')
  }
  if (cart.outletId !== null && cart.outletId !== input.outletId) {
    return {
      kind: 'outlet-conflict',
      currentOutletId: cart.outletId,
      requestedOutletId: input.outletId
    }
  }
  const existing = cart.lines.find((line) => line.listingId === input.listingId)
  const lines = existing
    ? cart.lines.map((line) => line.listingId === input.listingId
      ? { ...line, quantity: line.quantity + input.quantity }
      : line)
    : [...cart.lines, { listingId: input.listingId, quantity: input.quantity }]
  return { kind: 'updated', cart: { outletId: input.outletId, lines } }
}

export function replaceCartOutlet(cart: CustomerCart, outletId: string): CustomerCart {
  if (!outletId || cart.outletId === outletId) return cart
  return { outletId, lines: [] }
}

