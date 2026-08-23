import { CommandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { AppError } from '../../domain/result';

describe('CommandRunner and Synchronization Pipeline', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    runner = new CommandRunner();
    await commandStore.clear();
    connectivity.setConnected(true);
  });

  it('generates idempotency keys and executes successful mutations with ACKNOWLEDGED', async () => {
    let capturedIdempotency = '';
    const outcome = await runner.execute(
      {
        type: 'UPDATE_AVAILABILITY',
        jobId: null,
        payload: { online: true },
      },
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

    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
    expect(all[0].state).toBe('ACKNOWLEDGED');
    expect(all[0].commandType).toBe('UPDATE_AVAILABILITY');
    expect(all[0].payloadFingerprint).toBeDefined();
  });

  it('saves command as PENDING and returns PENDING when offline before send', async () => {
    connectivity.setConnected(false);

    let operationCalled = false;
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-offline-1',
        payload: { jobId: 'job-offline-1' },
      },
      async () => {
        operationCalled = true;
        return { id: 'job-offline-1', status: 'PICKED_UP' };
      },
    );

    expect(operationCalled).toBe(false);
    expect(outcome.outcome).toBe('PENDING');

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('PENDING');
    expect(pending[0].attemptCount).toBe(0);
  });

  it('marks outcome as REJECTED when API returns 400 validation error', async () => {
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-1',
        payload: { jobId: 'job-1' },
      },
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

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0); // REJECTED is terminal, not pending retry
  });

  it('marks outcome as UNKNOWN and preserves command for reconciliation when network drops', async () => {
    const outcome = await runner.execute(
      {
        type: 'MARK_DELIVERED',
        jobId: 'job-2',
        payload: { jobId: 'job-2' },
      },
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
    expect(pending[0].commandType).toBe('MARK_DELIVERED');
  });

  it('marks outcome as UNKNOWN when request times out', async () => {
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-timeout-1',
        payload: { jobId: 'job-timeout-1' },
      },
      async () => {
        throw AppError.timeout('Request timed out');
      },
    );

    expect(outcome.outcome).toBe('UNKNOWN');
    if (outcome.outcome === 'UNKNOWN') {
      expect(outcome.error.kind).toBe('Timeout');
    }

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('UNKNOWN');
  });

  it('deduplicates concurrent double taps into a single command execution', async () => {
    let executionCount = 0;
    const mockOperation = async () => {
      executionCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { success: true };
    };

    const promise1 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-double-tap',
        payload: { jobId: 'job-double-tap' },
      },
      mockOperation,
    );

    const promise2 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-double-tap',
        payload: { jobId: 'job-double-tap' },
      },
      mockOperation,
    );

    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(executionCount).toBe(1);
    expect(res1.commandId).toBe(res2.commandId);
    expect(res1.idempotencyKey).toBe(res2.idempotencyKey);

    const allCommands = await commandStore.listAll();
    expect(allCommands.length).toBe(1);
  });

  it('reuses the exact same commandId and idempotencyKey across 20 retries', async () => {
    const keysUsed: string[] = [];
    const commandIdsUsed: string[] = [];

    // First attempt fails with network error -> becomes UNKNOWN
    await runner.execute(
      {
        type: 'MARK_DELIVERED',
        jobId: 'job-retry-20',
        payload: { jobId: 'job-retry-20' },
      },
      async (key) => {
        keysUsed.push(key);
        throw AppError.network('Network dropped');
      },
    );

    // 19 subsequent retries
    for (let i = 0; i < 19; i++) {
      const outcome = await runner.execute(
        {
          type: 'MARK_DELIVERED',
          jobId: 'job-retry-20',
          payload: { jobId: 'job-retry-20' },
        },
        async (key) => {
          keysUsed.push(key);
          if (i === 18) {
            return { id: 'job-retry-20', status: 'DELIVERED' };
          }
          throw AppError.network('Network dropped');
        },
      );
      commandIdsUsed.push(outcome.commandId);
    }

    expect(keysUsed.length).toBe(20);
    // All 20 attempts must use the EXACT SAME idempotency key
    const uniqueKeys = new Set(keysUsed);
    expect(uniqueKeys.size).toBe(1);

    // All commands must map to the same single command record
    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
    expect(all[0].state).toBe('ACKNOWLEDGED');
    expect(all[0].attemptCount).toBe(20);
  });
});
