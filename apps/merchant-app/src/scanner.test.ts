import { describe, expect, it } from 'vitest'
import { OfflineActionQueue, ScannerCaptureGate } from './scanner'

describe('Merchant barcode scanner contract', () => {
  it('debounces rapid identical frames but keeps distinct captures', () => {
    const gate = new ScannerCaptureGate(750)
    expect(gate.capture('4006381333931', 1_000)).toBe(true)
    expect(gate.capture('4006381333931', 1_100)).toBe(false)
    expect(gate.capture('036000291452', 1_200)).toBe(true)
    expect(gate.capture('4006381333931', 1_800)).toBe(true)
  })

  it('replays one authorized offline action and reconciles conflicts', async () => {
    const queue = new OfflineActionQueue(10)
    queue.enqueue({ idempotencyKey: 'scan-a', barcode: '4006381333931', outletId: 'outlet-a' })
    queue.enqueue({ idempotencyKey: 'scan-a', barcode: '4006381333931', outletId: 'outlet-a' })
    const sent: string[] = []

    await queue.flush(async (action) => {
      sent.push(action.idempotencyKey)
      return { kind: 'existing-listing', listingId: 'listing-a' }
    })

    expect(sent).toEqual(['scan-a'])
    expect(queue.pending()).toEqual([])
  })
})

