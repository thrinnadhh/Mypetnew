import { CommandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { AppError } from '../../domain/result';

describe('CommandRunner and Synchronization Pipeline', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    runner = new CommandRunner();
    await commandStore.clear();
  });

  it('generates idempotency keys and executes successful mutations with ACKNOWLEDGED', async () => {
    let capturedIdempotency = '';
    const outcome = await runner.execute(
      'UPDATE_AVAILABILITY',
      { online: true },
      async (key) => {
        capturedIdempotency = key;
        return { online: true, approved: true };
      },
    );

    expect(outcome.outcome).toBe('ACKNOWLEDGED');
    expect(capturedIdempotency).toBeDefined();
    expect(capturedIdempotency.startsWith('idemp-')).toBe(true);

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0);
  });

  it('marks outcome as REJECTED when API returns 400 validation error', async () => {
    const outcome = await runner.execute(
      'MARK_PICKED_UP',
      { jobId: 'job-1' },
      async () => {
        throw AppError.fromHttp(400, {
          code: 'INVALID_PICKUP_OTP',
          message: 'The OTP entered is incorrect.',
        });
      },
    );

    expect(outcome.outcome).toBe('REJECTED');
    if (outcome.outcome === 'REJECTED') {
      expect(outcome.error.kind).toBe('ValidationRejected');
      expect(outcome.error.message).toBe('The OTP entered is incorrect.');
    }
  });

  it('marks outcome as UNKNOWN and preserves command for reconciliation when network drops', async () => {
    const outcome = await runner.execute(
      'MARK_DELIVERED',
      { jobId: 'job-2' },
      async () => {
        throw AppError.network('Connection reset by peer');
      },
    );

    expect(outcome.outcome).toBe('UNKNOWN');
    if (outcome.outcome === 'UNKNOWN') {
      expect(outcome.error.kind).toBe('NetworkUnavailable');
      expect(outcome.commandId).toBeDefined();
      expect(outcome.idempotencyKey).toBeDefined();
    }

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('UNKNOWN');
    expect(pending[0].type).toBe('MARK_DELIVERED');
  });
});
