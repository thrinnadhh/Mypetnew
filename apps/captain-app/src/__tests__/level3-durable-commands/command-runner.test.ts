import { CommandRunner } from '../../sync/command-runner';
import { commandStore, DurableStorageDriver } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { AppError } from '../../domain/result';

describe('Level 3: Durable CommandRunner Pipeline Tests', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    commandStore.resetStorageDriverForTesting();
    runner = new CommandRunner();
    await commandStore.clear();
    connectivity.setConnected(true);
  });

  it('deduplicates rapid double-tap requests on same resource into exactly ONE execution', async () => {
    let physicalNetworkCalls = 0;
    const mockServerCall = async () => {
      physicalNetworkCalls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { id: 'job-101', status: 'PICKED_UP' };
    };

    const promise1 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-101',
        jobId: 'job-101',
        payload: { jobId: 'job-101', pinCode: '1234' },
      },
      mockServerCall,
    );

    const promise2 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-101',
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

  it('proves storage write failure fails closed and blocks HTTP network operation', async () => {
    const brokenDriver: DurableStorageDriver = {
      async getItem() {
        return null;
      },
      async setItem() {
        throw new Error('STORAGE_IO_FAILURE: Out of disk space');
      },
      async removeItem() {},
      async clear() {},
    };

    commandStore.setStorageDriver(brokenDriver);

    let networkTransmitted = false;
    await expect(
      runner.execute(
        {
          type: 'MARK_DELIVERED',
          resourceType: 'DELIVERY_JOB',
          resourceId: 'job-fail-storage',
          payload: { jobId: 'job-fail-storage' },
        },
        async () => {
          networkTransmitted = true;
          return { status: 'DELIVERED' };
        },
      ),
    ).rejects.toThrow('STORAGE_IO_FAILURE: Out of disk space');

    expect(networkTransmitted).toBe(false);
  });

  it('reuses the exact same idempotencyKey and commandId across 20 retries', async () => {
    const keysObserved: string[] = [];
    const commandIdsObserved: string[] = [];

    for (let i = 0; i < 20; i++) {
      const outcome = await runner.execute(
        {
          type: 'MARK_DELIVERED',
          resourceType: 'DELIVERY_JOB',
          resourceId: 'job-retry-loop-1',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-distinct-keys',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-distinct-keys',
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

  it('proves concurrent operations on different offers execute independently without blocking or sharing results', async () => {
    let offerACalls = 0;
    let offerBCalls = 0;

    const pA = runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-alpha',
        payload: { offerId: 'offer-alpha' },
      },
      async () => {
        offerACalls++;
        await new Promise((r) => setTimeout(r, 20));
        return { offerId: 'offer-alpha', accepted: true };
      },
    );

    const pB = runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-beta',
        payload: { offerId: 'offer-beta' },
      },
      async () => {
        offerBCalls++;
        await new Promise((r) => setTimeout(r, 20));
        return { offerId: 'offer-beta', accepted: true };
      },
    );

    const [resA, resB] = await Promise.all([pA, pB]);

    expect(offerACalls).toBe(1);
    expect(offerBCalls).toBe(1);
    expect(resA.commandId).not.toBe(resB.commandId);
    expect(resA.idempotencyKey).not.toBe(resB.idempotencyKey);
  });

  it('rejects with IDEMPOTENCY_FINGERPRINT_MISMATCH when same active scope receives altered payload', async () => {
    // 1. First attempt fails with network error
    await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-fp-check',
        jobId: 'job-fp-check',
        payload: { jobId: 'job-fp-check', otp: '1111' },
      },
      async () => {
        throw AppError.network('Network dropped');
      },
    );

    // 2. Second attempt with different OTP
    await expect(
      runner.execute(
        {
          type: 'MARK_PICKED_UP',
          resourceType: 'DELIVERY_JOB',
          resourceId: 'job-fp-check',
          jobId: 'job-fp-check',
          payload: { jobId: 'job-fp-check', otp: '9999' },
        },
        async () => {
          return { status: 'PICKED_UP' };
        },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_FINGERPRINT_MISMATCH/);
  });

  it('handles offline queueing: saves as PENDING and skips dispatch when offline', async () => {
    connectivity.setConnected(false);

    let networkAttempted = false;
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-offline-01',
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
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'off-timeout-01',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-bad-otp',
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
