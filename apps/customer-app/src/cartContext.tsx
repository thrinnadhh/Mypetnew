import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

export interface CartProduct {
  readonly listingId: string
  readonly outletId: string
  readonly name: string
  readonly pricePaise: number
  readonly image?: string
}

export interface CartItem extends CartProduct {
  readonly quantity: number
}

interface CartState {
  readonly outletId: string | null
  readonly items: readonly CartItem[]
}

interface CartContextValue extends CartState {
  readonly itemCount: number
  readonly subtotalPaise: number
  readonly addProduct: (product: CartProduct) => 'added' | 'outlet-conflict'
  readonly replaceWithProduct: (product: CartProduct) => void
  readonly setQuantity: (listingId: string, quantity: number) => void
  readonly removeItem: (listingId: string) => void
  readonly clearCart: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export function CartProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<CartState>({ outletId: null, items: [] })

  const addProduct = useCallback((product: CartProduct): 'added' | 'outlet-conflict' => {
    if (state.outletId !== null && state.outletId !== product.outletId) return 'outlet-conflict'

    setState((current) => {
      const existing = current.items.find((item) => item.listingId === product.listingId)
      const items = existing
        ? current.items.map((item) => item.listingId === product.listingId
          ? { ...item, quantity: Math.min(100, item.quantity + 1) }
          : item)
        : [...current.items, { ...product, quantity: 1 }]
      return { outletId: product.outletId, items }
    })
    return 'added'
  }, [state.outletId])

  const replaceWithProduct = useCallback((product: CartProduct) => {
    setState({ outletId: product.outletId, items: [{ ...product, quantity: 1 }] })
  }, [])

  const setQuantity = useCallback((listingId: string, quantity: number) => {
    setState((current) => {
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100) return current
      const items = quantity === 0
        ? current.items.filter((item) => item.listingId !== listingId)
        : current.items.map((item) => item.listingId === listingId ? { ...item, quantity } : item)
      return { outletId: items.length === 0 ? null : current.outletId, items }
    })
  }, [])

  const removeItem = useCallback((listingId: string) => {
    setQuantity(listingId, 0)
  }, [setQuantity])

  const clearCart = useCallback(() => {
    setState({ outletId: null, items: [] })
  }, [])

  const value = useMemo<CartContextValue>(() => ({
    ...state,
    itemCount: state.items.reduce((total, item) => total + item.quantity, 0),
    subtotalPaise: state.items.reduce((total, item) => total + (item.pricePaise * item.quantity), 0),
    addProduct,
    replaceWithProduct,
    setQuantity,
    removeItem,
    clearCart
  }), [addProduct, clearCart, removeItem, replaceWithProduct, setQuantity, state])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext)
  if (value === null) throw new Error('useCart must be used inside CartProvider')
  return value
}
