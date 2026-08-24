import { fetchDeliveryHistory } from '../api/deliveries';
import { fetchCaptainEarnings } from '../api/earnings';
import { CaptainEarningsSummary } from '../domain/earnings';
import { AppError, err, ok, Result } from '../domain/result';

export class EarningsRepository {
  async getEarningsSummary(): Promise<Result<CaptainEarningsSummary>> {
    try {
      const summary = await fetchCaptainEarnings();
      return ok(summary);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async getDeliveryHistory(): Promise<Result<any[]>> {
    try {
      const history = await fetchDeliveryHistory();
      return ok(history);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }
}

export const earningsRepository = new EarningsRepository();
