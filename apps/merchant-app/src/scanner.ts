export interface QueuedScanAction {
  readonly idempotencyKey: string
  readonly barcode: string
  readonly outletId: string
}

export type ScanReplayResult =
  | { readonly kind: 'existing-listing'; readonly listingId: string }
  | { readonly kind: 'created-listing'; readonly listingId: string }
  | { readonly kind: 'conflict'; readonly message: string }

export class ScannerCaptureGate {
  private readonly captures = new Map<string, number>()

  public constructor(private readonly debounceMilliseconds: number) {
    if (!Number.isSafeInteger(debounceMilliseconds) || debounceMilliseconds < 0) {
      throw new Error('Debounce duration must be a non-negative integer')
    }
  }

  public capture(value: string, capturedAtMilliseconds: number): boolean {
    const previous = this.captures.get(value)
    if (previous !== undefined && capturedAtMilliseconds - previous < this.debounceMilliseconds) return false
    this.captures.set(value, capturedAtMilliseconds)
    return true
  }
}

export class OfflineActionQueue {
  private readonly actions = new Map<string, QueuedScanAction>()

  public constructor(private readonly capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new Error('Queue capacity must be positive')
  }

  public enqueue(action: QueuedScanAction): void {
    if (this.actions.has(action.idempotencyKey)) return
    if (this.actions.size >= this.capacity) throw new Error('Offline action queue is full')
    this.actions.set(action.idempotencyKey, action)
  }

  public pending(): readonly QueuedScanAction[] {
    return [...this.actions.values()]
  }

  public async flush(send: (action: QueuedScanAction) => Promise<ScanReplayResult>): Promise<void> {
    for (const action of this.actions.values()) {
      await send(action)
      this.actions.delete(action.idempotencyKey)
    }
  }
}
