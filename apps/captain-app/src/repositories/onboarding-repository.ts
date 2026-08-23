import { fetchOnboardingDraft, saveOnboardingDraft, submitOnboardingApplication } from '../api/onboarding';
import { OnboardingDraft } from '../domain/onboarding';
import { AppError, err, ok, Result } from '../domain/result';

export class OnboardingRepository {
  async getDraft(): Promise<Result<OnboardingDraft>> {
    try {
      const draft = await fetchOnboardingDraft();
      return ok(draft);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async saveDraft(draft: Partial<OnboardingDraft>): Promise<Result<OnboardingDraft>> {
    try {
      const saved = await saveOnboardingDraft(draft);
      return ok(saved);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }

  async submit(): Promise<Result<{ success: boolean; status: string }>> {
    try {
      const res = await submitOnboardingApplication();
      return ok(res);
    } catch (error: any) {
      return err(error instanceof AppError ? error : AppError.network(error.message));
    }
  }
}

export const onboardingRepository = new OnboardingRepository();
