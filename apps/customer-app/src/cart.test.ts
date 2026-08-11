import { describe, expect, it } from 'vitest'
import { addCartLine, createEmptyCart, replaceCartOutlet } from './cart'

describe('Customer single-outlet cart', () => {
  it('adds same-outlet lines and surfaces a different-outlet conflict', () => {
    const first = addCartLine(createEmptyCart(), { outletId: 'outlet-a', listingId: 'food', quantity: 1 })
    expect(first.kind).toBe('updated')
    if (first.kind !== 'updated') throw new Error('expected updated cart')

    const conflict = addCartLine(first.cart, { outletId: 'outlet-b', listingId: 'toy', quantity: 1 })
    expect(conflict).toEqual({ kind: 'outlet-conflict', currentOutletId: 'outlet-a', requestedOutletId: 'outlet-b' })
    expect(first.cart.lines).toHaveLength(1)
  })

  it('requires an explicit replace action', () => {
    const initial = addCartLine(createEmptyCart(), { outletId: 'outlet-a', listingId: 'food', quantity: 1 })
    if (initial.kind !== 'updated') throw new Error('expected updated cart')
    const replaced = replaceCartOutlet(initial.cart, 'outlet-b')
    expect(replaced.outletId).toBe('outlet-b')
    expect(replaced.lines).toEqual([])
  })

  it('merges matching lines and rejects unsafe quantities', () => {
    const first = addCartLine(createEmptyCart(), { outletId: 'outlet-a', listingId: 'food', quantity: 1 })
    if (first.kind !== 'updated') throw new Error('expected updated cart')
    const withToy = addCartLine(first.cart, { outletId: 'outlet-a', listingId: 'toy', quantity: 2 })
    if (withToy.kind !== 'updated') throw new Error('expected updated cart')
    const merged = addCartLine(withToy.cart, { outletId: 'outlet-a', listingId: 'food', quantity: 3 })
    expect(merged.kind).toBe('updated')
    if (merged.kind !== 'updated') throw new Error('expected updated cart')
    expect(merged.cart.lines).toEqual([
      { listingId: 'food', quantity: 4 },
      { listingId: 'toy', quantity: 2 }
    ])

    expect(() => addCartLine(first.cart, { outletId: 'outlet-a', listingId: 'food', quantity: 0 })).toThrow('Quantity')
    expect(() => addCartLine(first.cart, { outletId: 'outlet-a', listingId: 'food', quantity: 1.5 })).toThrow('Quantity')
    expect(() => addCartLine(first.cart, { outletId: 'outlet-a', listingId: 'food', quantity: 101 })).toThrow('Quantity')
  })

  it('keeps the cart when replacement is empty or unchanged', () => {
    const cart = createEmptyCart()
    expect(replaceCartOutlet(cart, '')).toBe(cart)
    const selected = replaceCartOutlet(cart, 'outlet-a')
    expect(replaceCartOutlet(selected, 'outlet-a')).toBe(selected)
  })
})
