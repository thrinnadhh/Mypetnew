import { DeliveryJob } from '../domain/delivery';
import { deliveryRepository } from '../repositories/delivery-repository';
import { commandStore } from './command-store';
import { connectivity } from './connectivity';

type ReconciliationListener = (updatedJob?: DeliveryJob | null) => void;

export class ReconciliationService {
  private isReconciling = false;
  private listeners: Set<ReconciliationListener> = new Set();

  constructor() {
    connectivity.subscribe((online) => {
      if (online) {
        this.reconcile();
      }
    });
  }

  subscribe(listener: ReconciliationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(job?: DeliveryJob | null): void {
    this.listeners.forEach((listener) => {
      try {
        listener(job);
      } catch {
        // Ignore listener error
      }
    });
  }

  async reconcile(): Promise<void> {
    if (this.isReconciling) return;
    this.isReconciling = true;

    try {
      const pending = await commandStore.listPending();
      if (pending.length === 0) return;

      const activeResult = await deliveryRepository.getActiveDelivery();
      if (!activeResult.success) {
        return;
      }

      const serverJob = activeResult.data;

      for (const cmd of pending) {
        const cmdType = cmd.commandType || cmd.type;
        const jobId = cmd.jobId || (cmd.payload as any)?.jobId;

        if (cmdType === 'MARK_PICKED_UP' && jobId) {
          if (serverJob && serverJob.jobId === jobId) {
            if (
              serverJob.state === 'PICKED_UP' ||
              serverJob.state === 'ARRIVING_CUSTOMER' ||
              serverJob.state === 'DELIVERY_CONFIRMING' ||
              serverJob.state === 'DELIVERED'
            ) {
              // Server committed pickup
              cmd.state = 'ACKNOWLEDGED';
              cmd.lastErrorCode = null;
              cmd.lastError = null;
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify(serverJob);
            } else if (serverJob.state === 'FAILED') {
              cmd.state = 'REJECTED';
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify(serverJob);
            } else if (serverJob.state === 'ASSIGNED' || serverJob.state === 'ARRIVING_PICKUP') {
              // Server did not receive/commit pickup yet
              if (cmd.state === 'UNKNOWN' || cmd.state === 'SENDING') {
                cmd.state = 'PENDING';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
              }
              // If connected, retry with exact same idempotency key and command ID
              if (connectivity.online) {
                const outcome = await deliveryRepository.markPickedUp(
                  jobId,
                  (cmd.payload as any)?.proof,
                  cmd.commandId,
                  cmd.idempotencyKey,
                );
                if (outcome.outcome === 'ACKNOWLEDGED') {
                  this.notify({
                    ...serverJob,
                    state: 'PICKED_UP',
                    pickedUpAt: outcome.data.pickedUpAt || new Date().toISOString(),
                    pickupProof: (cmd.payload as any)?.proof,
                  });
                }
              }
            }
          }
        } else if (cmdType === 'MARK_DELIVERED' && jobId) {
          if (serverJob && serverJob.jobId === jobId) {
            if (serverJob.state === 'DELIVERED') {
              // Server committed delivery
              cmd.state = 'ACKNOWLEDGED';
              cmd.lastErrorCode = null;
              cmd.lastError = null;
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify(serverJob);
            } else if (serverJob.state === 'FAILED') {
              cmd.state = 'REJECTED';
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify(serverJob);
            } else if (
              serverJob.state === 'PICKED_UP' ||
              serverJob.state === 'ARRIVING_CUSTOMER'
            ) {
              // Server did not receive/commit delivery yet
              if (cmd.state === 'UNKNOWN' || cmd.state === 'SENDING') {
                cmd.state = 'PENDING';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
              }
              // If connected, retry with exact same idempotency key and command ID
              if (connectivity.online) {
                const outcome = await deliveryRepository.markDelivered(
                  jobId,
                  (cmd.payload as any)?.proof,
                  cmd.commandId,
                  cmd.idempotencyKey,
                );
                if (outcome.outcome === 'ACKNOWLEDGED') {
                  this.notify({
                    ...serverJob,
                    state: 'DELIVERED',
                    deliveredAt: outcome.data.deliveredAt || new Date().toISOString(),
                    deliveryProof: (cmd.payload as any)?.proof,
                  });
                }
              }
            }
          } else if (serverJob === null) {
            // Completed and cleared from active dispatches on backend
            cmd.state = 'ACKNOWLEDGED';
            cmd.lastErrorCode = null;
            cmd.lastError = null;
            cmd.updatedAt = new Date().toISOString();
            await commandStore.save(cmd);
            this.notify(null);
          }
        }
      }
    } finally {
      this.isReconciling = false;
    }
  }
}

export const reconciliationService = new ReconciliationService();
