import { fetchActiveDelivery } from '../api/deliveries';
import { fetchDispatchJob, DispatchJobResponse, markJobDelivered, markJobPickedUp } from '../api/dispatch';
import { CommandOutcome } from '../domain/command';
import { DeliveryJob, DeliveryProof } from '../domain/delivery';
import { AppError, err, ok, Result } from '../domain/result';
import { commandRunner } from '../sync/command-runner';

export class DeliveryRepository {
  async getActiveDelivery(): Promise<Result<DeliveryJob | null>> {
    try {
      const job = await fetchActiveDelivery();
      return ok(job);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async getDispatchJob(jobId: string): Promise<Result<DispatchJobResponse>> {
    try {
      const job = await fetchDispatchJob(jobId);
      return ok(job);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async markPickedUp(
    jobId: string,
    proof?: DeliveryProof,
    existingCommandId?: string,
    existingIdempotencyKey?: string,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> {
    return commandRunner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: jobId,
        jobId,
        payload: { jobId, proof },
        existingCommandId,
        existingIdempotencyKey,
      },
      async (idempotencyKey) => {
        const res = await markJobPickedUp(jobId, idempotencyKey);
        return {
          jobId: res.id,
          orderId: res.orderId,
          outletId: res.outletId,
          originLatitude: res.originLatitude,
          originLongitude: res.originLongitude,
          state: 'PICKED_UP',
          pickedUpAt: res.pickedUpAt || new Date().toISOString(),
          pickupProof: proof,
        };
      },
    );
  }

  async markDelivered(
    jobId: string,
    proof?: DeliveryProof,
    existingCommandId?: string,
    existingIdempotencyKey?: string,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> {
    return commandRunner.execute(
      {
        type: 'MARK_DELIVERED',
        resourceType: 'DELIVERY_JOB',
        resourceId: jobId,
        jobId,
        payload: { jobId, proof },
        existingCommandId,
        existingIdempotencyKey,
      },
      async (idempotencyKey) => {
        const res = await markJobDelivered(jobId, idempotencyKey);
        return {
          jobId: res.id,
          orderId: res.orderId,
          outletId: res.outletId,
          originLatitude: res.originLatitude,
          originLongitude: res.originLongitude,
          state: 'DELIVERED',
          deliveredAt: res.deliveredAt || new Date().toISOString(),
          deliveryProof: proof,
        };
      },
    );
  }
}

export const deliveryRepository = new DeliveryRepository();
