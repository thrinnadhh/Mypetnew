import { CaptainAvailabilityParams, CaptainDeliveryStateResponse, updateCaptainAvailability } from '../api/availability';
import { CommandOutcome } from '../domain/command';
import { commandRunner } from '../sync/command-runner';

export class AvailabilityRepository {
  async updateAvailability(
    params: CaptainAvailabilityParams,
  ): Promise<CommandOutcome<CaptainDeliveryStateResponse>> {
    return commandRunner.execute(
      {
        type: 'UPDATE_AVAILABILITY',
        resourceType: 'CAPTAIN_AVAILABILITY',
        resourceId: (params as any).captainId || 'self',
        payload: params,
      },
      async () => {
        return await updateCaptainAvailability(params);
      },
    );
  }
}

export const availabilityRepository = new AvailabilityRepository();
