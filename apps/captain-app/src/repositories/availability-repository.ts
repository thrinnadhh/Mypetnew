import { CaptainAvailabilityParams, CaptainDeliveryStateResponse, updateCaptainAvailability } from '../api/availability';
import { CommandOutcome } from '../domain/command';
import { commandRunner } from '../sync/command-runner';

export class AvailabilityRepository {
  async updateAvailability(
    params: CaptainAvailabilityParams,
    existingCommandId?: string,
    existingIdempotencyKey?: string,
  ): Promise<CommandOutcome<CaptainDeliveryStateResponse>> {
    return commandRunner.execute(
      {
        type: 'UPDATE_AVAILABILITY',
        resourceType: 'CAPTAIN_AVAILABILITY',
        resourceId: (params as any).captainId || 'self',
        payload: params,
        existingCommandId,
        existingIdempotencyKey,
      },
      async (idempotencyKey) => {
        return await updateCaptainAvailability(params, idempotencyKey);
      },
    );
  }
}

export const availabilityRepository = new AvailabilityRepository();
