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
})

