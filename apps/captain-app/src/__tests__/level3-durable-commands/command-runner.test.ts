import { CommandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { AppError } from '../../domain/result';

describe('Level 3: Durable CommandRunner Pipeline Tests', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    runner = new CommandRunner();
    await commandStore.clear();
    connectivity.setConnected(true);
  });

  it('deduplicates rapid double-tap requests into exactly ONE execution', async () => {
    let physicalNetworkCalls = 0;
    const mockServerCall = async () => {
      physicalNetworkCalls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: 'job-101', status: 'PICKED_UP' };
    };

    const promise1 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-101',
        payload: { jobId: 'job-101', pinCode: '1234' },
      },
      mockServerCall,
    );

    const promise2 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-101',
        payload: { jobId: 'job-101', pinCode: '1234' },
      },
      mockServerCall,
    );

    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(physicalNetworkCalls).toBe(1);
    expect(res1.commandId).toBe(res2.commandId);
    expect(res1.idempotencyKey).toBe(res2.idempotencyKey);
    expect(res1.outcome).toBe('ACKNOWLEDGED');
    expect(res2.outcome).toBe('ACKNOWLEDGED');

    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
  });

  it('reuses the exact same idempotencyKey and commandId across 20 retries', async () => {
    const keysObserved: string[] = [];
    const commandIdsObserved: string[] = [];

    for (let i = 0; i < 20; i++) {
      const outcome = await runner.execute(
        {
          type: 'MARK_DELIVERED',
          jobId: 'job-retry-loop-1',
          payload: { jobId: 'job-retry-loop-1' },
        },
        async (key) => {
          keysObserved.push(key);
          if (i === 19) {
            return { id: 'job-retry-loop-1', status: 'DELIVERED' };
          }
          throw AppError.network('Network connection lost');
        },
      );
      commandIdsObserved.push(outcome.commandId);
    }

    expect(keysObserved.length).toBe(20);
    // Every single retry must use the exact same idempotency key
    const uniqueKeys = new Set(keysObserved);
    expect(uniqueKeys.size).toBe(1);

    const uniqueCommandIds = new Set(commandIdsObserved);
    expect(uniqueCommandIds.size).toBe(1);

    const record = await commandStore.get(commandIdsObserved[0]);
    expect(record?.state).toBe('ACKNOWLEDGED');
    expect(record?.attemptCount).toBe(20);
  });

  it('generates different keys for different operations on the same job', async () => {
    let pickupKey = '';
    let delivKey = '';

    await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-distinct-keys',
        payload: { jobId: 'job-distinct-keys' },
      },
      async (k) => {
        pickupKey = k;
        return { id: 'job-distinct-keys', status: 'PICKED_UP' };
      },
    );

    await runner.execute(
      {
        type: 'MARK_DELIVERED',
        jobId: 'job-distinct-keys',
        payload: { jobId: 'job-distinct-keys' },
      },
      async (k) => {
        delivKey = k;
        return { id: 'job-distinct-keys', status: 'DELIVERED' };
      },
    );

    expect(pickupKey).not.toBe(delivKey);
    const all = await commandStore.listAll();
    expect(all.length).toBe(2);
  });

  it('handles offline queueing: saves as PENDING and skips dispatch when offline', async () => {
    connectivity.setConnected(false);

    let networkAttempted = false;
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-offline-01',
        payload: { jobId: 'job-offline-01' },
      },
      async () => {
        networkAttempted = true;
        return { status: 'PICKED_UP' };
      },
    );

    expect(networkAttempted).toBe(false);
    expect(outcome.outcome).toBe('PENDING');

    const pending = await commandStore.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].state).toBe('PENDING');
  });

  it('persists command as UNKNOWN on network timeout and keeps command pending reconciliation', async () => {
    const outcome = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        jobId: 'job-timeout-01',
        payload: { offerId: 'off-timeout-01' },
      },
      async () => {
        throw AppError.timeout('Gateway timeout 504');
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

  it('marks outcome as REJECTED and removes from pending on 400 validation rejection', async () => {
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        jobId: 'job-bad-otp',
        payload: { jobId: 'job-bad-otp' },
      },
      async () => {
        throw AppError.fromHttp(400, { code: 'INVALID_OTP', message: 'Wrong OTP' });
      },
    );

    expect(outcome.outcome).toBe('REJECTED');
    const pending = await commandStore.listPending();
    expect(pending.length).toBe(0); // REJECTED is terminal, does not retry
  });
});
