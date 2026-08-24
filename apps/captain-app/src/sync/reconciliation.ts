import { getAuthGeneration, getRuntimeAccountId } from '../auth/session';
import { DeliveryJob } from '../domain/delivery';
import { ok } from '../domain/result';
import { availabilityRepository } from '../repositories/availability-repository';
import { deliveryRepository } from '../repositories/delivery-repository';
import { dispatchRepository } from '../repositories/dispatch-repository';
import { commandRequiresPinReentry, commandStore } from './command-store';
import { connectivity } from './connectivity';
import { logger } from '../utils/privacy';

type ReconciliationListener = (updatedJob?: DeliveryJob | Partial<DeliveryJob> | null) => void;

export class ReconciliationService {
  private reconcileInFlight: Promise<void> | null = null;
  private reconcileRequested = false;
  private listeners: Set<ReconciliationListener> = new Set();

  constructor() {
    connectivity.subscribe((online) => {
      if (online) {
        this.reconcile().catch(() => {});
      }
    });
  }

  subscribe(listener: ReconciliationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(job?: DeliveryJob | Partial<DeliveryJob> | null): void {
    this.listeners.forEach((listener) => {
      try {
        listener(job);
      } catch {
        // Ignore listener error
      }
    });
  }

  async reconcile(): Promise<void> {
    this.reconcileRequested = true;
    if (this.reconcileInFlight) return this.reconcileInFlight;
    const flight = (async () => {
      do {
        this.reconcileRequested = false;
        await this.runReconciliation();
      } while (this.reconcileRequested);
    })();
    this.reconcileInFlight = flight;
    try {
      await flight;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith('STORAGE_CORRUPTION_DETECTED:')
      ) {
        // Fail closed for mutations, but do not crash authenticated bootstrap. A future
        // logout/reset can still clear the corrupt journal, and no command is replayed.
        logger.error('Reconciliation', 'Mutation journal is corrupt; automatic replay is blocked');
        return;
      }
      throw error;
    } finally {
      if (this.reconcileInFlight === flight) this.reconcileInFlight = null;
    }
  }

  private async runReconciliation(): Promise<void> {
    try {
      const captainId = getRuntimeAccountId();
      if (!captainId && process.env.NODE_ENV !== 'test') return;
      const authGeneration = getAuthGeneration();
      const sessionIsCurrent = () =>
        getRuntimeAccountId() === captainId && getAuthGeneration() === authGeneration;

      const pending = await commandStore.listPending(captainId || undefined);
      if (pending.length === 0) return;

      // 1. Availability Supersession Pre-pass:
      // If there are multiple availability commands, mark older ones as SUPERSEDED
      const availabilityCommands = pending.filter(
        (cmd) => (cmd.commandType || cmd.type) === 'UPDATE_AVAILABILITY',
      );
      if (availabilityCommands.length > 1) {
        // Sort chronologically ascending
        availabilityCommands.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        // All except the last (latest desired state) are superseded
        for (let i = 0; i < availabilityCommands.length - 1; i++) {
          const oldCmd = availabilityCommands[i];
          oldCmd.state = 'SUPERSEDED';
          oldCmd.updatedAt = new Date().toISOString();
          await commandStore.save(oldCmd);
        }
      }

      // Re-read pending after availability supersession
      const activePending = await commandStore.listPending(captainId || undefined);

      for (const cmd of activePending) {
        if (!sessionIsCurrent()) return;
        const cmdType = cmd.commandType || cmd.type;
        const jobId = cmd.jobId || (cmd.payload as any)?.jobId || cmd.resourceId;
        const commandIsStillActive = async () => {
          const latest = await commandStore.get(cmd.commandId, captainId || undefined);
          return !!latest && ['PENDING', 'SENDING', 'UNKNOWN'].includes(latest.state);
        };

        if (cmdType === 'MARK_PICKED_UP' && jobId) {
          // Authoritative lookup for this specific job
          let jobRes = await deliveryRepository.getDispatchJob(jobId);
          if (!(await commandIsStillActive())) continue;
          if (!jobRes.success) {
            const activeRes = await deliveryRepository.getActiveDelivery();
            if (activeRes.success && activeRes.data && activeRes.data.jobId === jobId) {
              jobRes = ok({
                jobId: activeRes.data.jobId,
                orderId: activeRes.data.orderId,
                outletId: activeRes.data.outletId,
                status: activeRes.data.state as any,
                pickedUpAt: activeRes.data.pickedUpAt || undefined,
              });
            }
          }

          if (jobRes.success) {
            const job = jobRes.data;
            const status = job.status;

            if (status === 'PICKED_UP' || status === 'DELIVERED') {
              cmd.state = 'ACKNOWLEDGED';
              cmd.lastErrorCode = null;
              cmd.lastError = null;
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify({
                jobId: job.id || job.jobId || jobId,
                orderId: job.orderId,
                outletId: job.outletId,
                state: status === 'DELIVERED' ? 'DELIVERED' : 'PICKED_UP',
                pickedUpAt: job.pickedUpAt || new Date().toISOString(),
                deliveredAt: job.deliveredAt || undefined,
              });
            } else if (status === 'FAILED') {
              cmd.state = 'REJECTED';
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
            } else if (status === 'ASSIGNED' || status === 'SEARCHING' || status === 'OFFERED') {
              // Server has not processed pickup yet
              if (status === 'ASSIGNED' && commandRequiresPinReentry(cmd)) {
                // The secure proof secret did not survive process restoration. The
                // authoritative lookup proves the old mutation did not commit, so retire
                // its key and let the Captain submit a newly entered PIN intentionally.
                cmd.state = 'SUPERSEDED';
                cmd.lastErrorCode = 'PROOF_REENTRY_REQUIRED';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
                this.notify({
                  jobId: job.id || job.jobId || jobId,
                  orderId: job.orderId,
                  outletId: job.outletId,
                  state: 'ASSIGNED',
                });
                continue;
              }
              if (cmd.state === 'UNKNOWN' || cmd.state === 'SENDING') {
                cmd.state = 'PENDING';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
              }
              // If connected, retry with exact same idempotency key and command ID
              if (connectivity.online && !commandRequiresPinReentry(cmd)) {
                const outcome = await deliveryRepository.markPickedUp(
                  jobId,
                  (cmd.payload as any)?.proof,
                  cmd.commandId,
                  cmd.idempotencyKey,
                );
                if (outcome.outcome === 'ACKNOWLEDGED') {
                  this.notify({
                    jobId: outcome.data.jobId || jobId,
                    orderId: outcome.data.orderId || '',
                    outletId: outcome.data.outletId || '',
                    state: 'PICKED_UP',
                    pickedUpAt: outcome.data.pickedUpAt || new Date().toISOString(),
                    pickupProof: (cmd.payload as any)?.proof,
                  });
                }
              }
            }
          } else {
            // Lookup failed (network, 5xx, or 404)
            // INVARIANT: Do NOT infer success or rejection. Remain UNKNOWN/PENDING.
          }
        } else if (cmdType === 'MARK_DELIVERED' && jobId) {
          // Authoritative lookup for this specific job
          let jobRes = await deliveryRepository.getDispatchJob(jobId);
          if (!(await commandIsStillActive())) continue;
          if (!jobRes.success) {
            const activeRes = await deliveryRepository.getActiveDelivery();
            if (activeRes.success && activeRes.data && activeRes.data.jobId === jobId) {
              jobRes = ok({
                jobId: activeRes.data.jobId,
                orderId: activeRes.data.orderId,
                outletId: activeRes.data.outletId,
                status: activeRes.data.state === 'DELIVERED' ? 'DELIVERED' : 'PICKED_UP',
                deliveredAt: activeRes.data.deliveredAt || undefined,
                pickedUpAt: activeRes.data.pickedUpAt || undefined,
              });
            }
          }

          if (jobRes.success) {
            const job = jobRes.data;
            const status = job.status;

            if (status === 'DELIVERED') {
              // Server explicitly confirms DELIVERED
              cmd.state = 'ACKNOWLEDGED';
              cmd.lastErrorCode = null;
              cmd.lastError = null;
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
              this.notify({
                jobId: job.id || job.jobId || jobId,
                orderId: job.orderId,
                outletId: job.outletId,
                state: 'DELIVERED',
                deliveredAt: job.deliveredAt || new Date().toISOString(),
              });
            } else if (status === 'FAILED') {
              cmd.state = 'REJECTED';
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
            } else if (status === 'PICKED_UP' || status === 'ASSIGNED') {
              // Server has not processed delivery yet
              if (status === 'PICKED_UP' && commandRequiresPinReentry(cmd)) {
                cmd.state = 'SUPERSEDED';
                cmd.lastErrorCode = 'PROOF_REENTRY_REQUIRED';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
                this.notify({
                  jobId: job.id || job.jobId || jobId,
                  orderId: job.orderId,
                  outletId: job.outletId,
                  state: 'PICKED_UP',
                  pickedUpAt: job.pickedUpAt || new Date().toISOString(),
                });
                continue;
              }
              if (cmd.state === 'UNKNOWN' || cmd.state === 'SENDING') {
                cmd.state = 'PENDING';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
              }
              // If connected, retry with exact same idempotency key and command ID
              if (connectivity.online && !commandRequiresPinReentry(cmd)) {
                const outcome = await deliveryRepository.markDelivered(
                  jobId,
                  (cmd.payload as any)?.proof,
                  cmd.commandId,
                  cmd.idempotencyKey,
                );
                if (outcome.outcome === 'ACKNOWLEDGED') {
                  this.notify({
                    jobId: outcome.data.jobId || jobId,
                    orderId: outcome.data.orderId || '',
                    outletId: outcome.data.outletId || '',
                    state: 'DELIVERED',
                    deliveredAt: outcome.data.deliveredAt || new Date().toISOString(),
                    deliveryProof: (cmd.payload as any)?.proof,
                  });
                }
              }
            }
          } else {
            // Lookup failed (network, 5xx, or 404/absence)
            // CRITICAL INVARIANT: Never infer success when activeDelivery is null or GET job fails!
            // Remain UNKNOWN/PENDING.
          }
        } else if (cmdType === 'ACCEPT_OFFER') {
          const offerId = (cmd.payload as any)?.offerId || cmd.resourceId;
          const targetJobId = (cmd.payload as any)?.jobId || cmd.jobId;

          // Check if server shows active delivery for this Captain
          const activeRes = await deliveryRepository.getActiveDelivery();
          if (activeRes.success && activeRes.data && (!targetJobId || activeRes.data.jobId === targetJobId)) {
            // Server assigned delivery to this Captain!
            cmd.state = 'ACKNOWLEDGED';
            cmd.lastErrorCode = null;
            cmd.lastError = null;
            cmd.updatedAt = new Date().toISOString();
            await commandStore.save(cmd);
            this.notify(activeRes.data);
          } else {
            // Check if offer is still pending in offers list
            const offersRes = await dispatchRepository.getPendingOffers();
            if (offersRes.success) {
              const pendingOffers = offersRes.data;
              const isStillPending = pendingOffers.some((o) => o.offerId === offerId);

              if (isStillPending && connectivity.online) {
                // Retry acceptance with exact same command ID and idempotency key
                const outcome = await dispatchRepository.respondToOffer(
                  offerId,
                  'ACCEPT',
                  cmd.commandId,
                  cmd.idempotencyKey,
                );
                if (outcome.outcome === 'ACKNOWLEDGED') {
                  this.notify();
                }
              } else if (!isStillPending) {
                // Offer expired or assigned to someone else with no assignment to this Captain
                cmd.state = 'REJECTED';
                cmd.updatedAt = new Date().toISOString();
                await commandStore.save(cmd);
              }
            }
          }
        } else if (cmdType === 'REJECT_OFFER') {
          const offerId = (cmd.payload as any)?.offerId || cmd.resourceId;
          const offersRes = await dispatchRepository.getPendingOffers();
          if (offersRes.success) {
            const pendingOffers = offersRes.data;
            const isStillPending = pendingOffers.some((o) => o.offerId === offerId);
            if (!isStillPending) {
              // Offer no longer pending
              cmd.state = 'ACKNOWLEDGED';
              cmd.updatedAt = new Date().toISOString();
              await commandStore.save(cmd);
            } else if (connectivity.online) {
              await dispatchRepository.respondToOffer(
                offerId,
                'REJECT',
                cmd.commandId,
                cmd.idempotencyKey,
              );
            }
          }
        } else if (cmdType === 'UPDATE_AVAILABILITY') {
          // If connectivity is restored, execute the latest desired state
          if (connectivity.online) {
            const params = cmd.payload as any;
            await availabilityRepository.updateAvailability(
              params,
              cmd.commandId,
              cmd.idempotencyKey,
            );
          }
        }
      }
    } finally {
      // Public reconcile() owns and clears the single-flight promise.
    }
  }
}

export const reconciliationService = new ReconciliationService();
