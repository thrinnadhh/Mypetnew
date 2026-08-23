import { fetchPendingOffers, respondToOffer } from '../api/dispatch';
import { CommandOutcome } from '../domain/command';
import { DispatchAssignment, DispatchOffer } from '../domain/dispatch';
import { AppError, err, ok, Result } from '../domain/result';
import { commandRunner } from '../sync/command-runner';

export class DispatchRepository {
  async getPendingOffers(): Promise<Result<DispatchOffer[]>> {
    try {
      const projections = await fetchPendingOffers();
      const offers: DispatchOffer[] = projections.map((p) => ({
        offerId: p.offerId,
        jobId: p.jobId,
        expiresAt: p.expiresAt,
        state: 'PENDING',
        outletName: p.outletName,
        area: p.area,
        distanceMeters: p.distanceMeters,
        itemCount: p.itemCount,
        estimatedEarningPaise: p.estimatedEarningPaise,
        receivedAt: new Date().toISOString(),
      }));
      return ok(offers);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async respondToOffer(
    offerId: string,
    action: 'ACCEPT' | 'REJECT',
  ): Promise<CommandOutcome<DispatchAssignment>> {
    const commandType = action === 'ACCEPT' ? 'ACCEPT_OFFER' : 'REJECT_OFFER';

    return commandRunner.execute(
      commandType,
      { offerId, action },
      async (idempotencyKey) => {
        const res = await respondToOffer(offerId, action, idempotencyKey);
        if (!res.accepted || !res.jobId || !res.orderId || !res.outletId || !res.deliveryAddress) {
          if (action === 'REJECT') {
            return {
              accepted: false,
              jobId: '',
              orderId: '',
              outletId: '',
              outletName: '',
              deliveryAddress: {
                addressId: '',
                recipientName: '',
                phoneNumber: '',
                line1: '',
                city: '',
                state: '',
                pincode: '',
              },
            };
          }
          throw AppError.fromHttp(409, {
            code: 'OFFER_UNAVAILABLE',
            message: 'Offer is no longer available or was accepted by another captain.',
          });
        }

        return {
          accepted: true,
          jobId: res.jobId,
          orderId: res.orderId,
          outletId: res.outletId,
          outletName: res.outletName || 'Merchant Store',
          deliveryAddress: {
            addressId: res.deliveryAddress.addressId,
            recipientName: res.deliveryAddress.recipientName,
            phoneNumber: res.deliveryAddress.phoneNumber,
            line1: res.deliveryAddress.line1,
            line2: res.deliveryAddress.line2,
            city: res.deliveryAddress.city,
            state: res.deliveryAddress.state,
            pincode: res.deliveryAddress.pincode,
          },
        };
      },
    );
  }
}

export const dispatchRepository = new DispatchRepository();
