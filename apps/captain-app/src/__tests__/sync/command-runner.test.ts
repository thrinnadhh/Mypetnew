import { CommandRunner } from '../../sync/command-runner';
import { commandStore, DurableStorageDriver } from '../../sync/command-store';
import { connectivity } from '../../sync/connectivity';
import { AppError } from '../../domain/result';
import { clearSession, storeSession } from '../../auth/session';

describe('CommandRunner and Synchronization Pipeline', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    await clearSession();
    commandStore.resetStorageDriverForTesting();
    runner = new CommandRunner();
    await commandStore.clear();
    connectivity.setConnected(true);
  });

  const sessionFor = (accountId: string) => ({
    accountId,
    accessToken: `${accountId}-access`,
    refreshToken: `${accountId}-refresh`,
    accessTokenExpiresAt: '2026-08-23T12:00:00Z',
    refreshTokenExpiresAt: '2026-09-23T12:00:00Z',
    role: 'CAPTAIN',
  });

  it('does not reuse Captain A pending command or idempotency key for Captain B', async () => {
    connectivity.setConnected(false);
    await storeSession(sessionFor('captain-a'));
    const captainA = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'shared-offer',
        payload: { offerId: 'shared-offer' },
      },
      async () => ({ accepted: true }),
    );

    await storeSession(sessionFor('captain-b'));
    const captainB = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'shared-offer',
        payload: { offerId: 'shared-offer' },
      },
      async () => ({ accepted: true }),
    );

    expect(captainA.commandId).not.toBe(captainB.commandId);
    expect(captainA.idempotencyKey).not.toBe(captainB.idempotencyKey);
    expect((await commandStore.listPending('captain-a'))).toHaveLength(1);
    expect((await commandStore.listPending('captain-b'))).toHaveLength(1);
  });

  it('does not acknowledge Captain A mutation after an account switch', async () => {
    await storeSession(sessionFor('captain-a'));
    let resolveMutation!: (value: { accepted: boolean }) => void;
    const pending = runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-race',
        payload: { offerId: 'offer-race' },
      },
      () => new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await storeSession(sessionFor('captain-b'));
    resolveMutation({ accepted: true });

    await expect(pending).resolves.toMatchObject({
      outcome: 'UNKNOWN',
      error: { code: 'STALE_COMMAND_SESSION' },
    });
    expect((await commandStore.listAll('captain-b'))).toHaveLength(0);
    expect((await commandStore.listAll('captain-a'))[0].state).toBe('SENDING');
  });

  it('generates idempotency keys and executes successful mutations with ACKNOWLEDGED', async () => {
    let capturedIdempotency = '';
    const outcome = await runner.execute(
      {
        type: 'UPDATE_AVAILABILITY',
        resourceType: 'CAPTAIN_AVAILABILITY',
        resourceId: 'capt-01',
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

  it('Requirement 1: Storage write failure prevents HTTP operation invocation', async () => {
    const faultyDriver: DurableStorageDriver = {
      async getItem() {
        return null;
      },
      async setItem() {
        throw new Error('EACCES: Permission denied / Storage unavailable');
      },
      async removeItem() {},
      async clear() {},
    };

    commandStore.setStorageDriver(faultyDriver);

    let httpOperationInvoked = false;
    const testRunner = new CommandRunner();

    await expect(
      testRunner.execute(
        {
          type: 'ACCEPT_OFFER',
          resourceType: 'DISPATCH_OFFER',
          resourceId: 'offer-storage-fail',
          payload: { offerId: 'offer-storage-fail' },
        },
        async () => {
          httpOperationInvoked = true;
          return { accepted: true };
        },
      ),
    ).rejects.toThrow('EACCES: Permission denied / Storage unavailable');

    // INVARIANT ASSERTION: Network MUST NEVER be called if local persistence fails
    expect(httpOperationInvoked).toBe(false);
  });

  it('Requirement 4: ACCEPT offer A and ACCEPT offer B produce different commandId, idempotencyKey, and mutex identity', async () => {
    let keyA = '';
    let keyB = '';

    const outcomeA = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-AAA',
        payload: { offerId: 'offer-AAA' },
      },
      async (key) => {
        keyA = key;
        return { offerId: 'offer-AAA', accepted: true };
      },
    );

    const outcomeB = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-BBB',
        payload: { offerId: 'offer-BBB' },
      },
      async (key) => {
        keyB = key;
        return { offerId: 'offer-BBB', accepted: true };
      },
    );

    expect(outcomeA.commandId).not.toBe(outcomeB.commandId);
    expect(outcomeA.idempotencyKey).not.toBe(outcomeB.idempotencyKey);
    expect(keyA).not.toBe(keyB);

    const all = await commandStore.listAll();
    expect(all.length).toBe(2);
    expect(all.map((c) => c.resourceId).sort()).toEqual(['offer-AAA', 'offer-BBB']);
  });

  it('Requirement 5: Concurrent Accept A / Accept B do not share Promise/result', async () => {
    let callCountA = 0;
    let callCountB = 0;

    const promiseA = runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-A-concurrent',
        payload: { offerId: 'offer-A-concurrent' },
      },
      async () => {
        callCountA++;
        await new Promise((r) => setTimeout(r, 30));
        return { offerId: 'offer-A-concurrent', status: 'ASSIGNED_A' };
      },
    );

    const promiseB = runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-B-concurrent',
        payload: { offerId: 'offer-B-concurrent' },
      },
      async () => {
        callCountB++;
        await new Promise((r) => setTimeout(r, 30));
        return { offerId: 'offer-B-concurrent', status: 'ASSIGNED_B' };
      },
    );

    const [resA, resB] = await Promise.all([promiseA, promiseB]);

    expect(callCountA).toBe(1);
    expect(callCountB).toBe(1);
    expect(resA.commandId).not.toBe(resB.commandId);
    expect(resA.idempotencyKey).not.toBe(resB.idempotencyKey);
    if (resA.outcome === 'ACKNOWLEDGED' && resB.outcome === 'ACKNOWLEDGED') {
      expect(resA.data.status).toBe('ASSIGNED_A');
      expect(resB.data.status).toBe('ASSIGNED_B');
    }
  });

  it('Requirement 6: Same command replay with same payload reuses same idempotency key', async () => {
    const keysUsed: string[] = [];

    // First attempt -> network drop -> UNKNOWN
    await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-replay-01',
        jobId: 'job-replay-01',
        payload: { jobId: 'job-replay-01', pinCode: '4321' },
      },
      async (k) => {
        keysUsed.push(k);
        throw AppError.network('Network dropped on transmission');
      },
    );

    // Second attempt -> replay with exact same payload
    const outcome2 = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-replay-01',
        jobId: 'job-replay-01',
        payload: { jobId: 'job-replay-01', pinCode: '4321' },
      },
      async (k) => {
        keysUsed.push(k);
        return { id: 'job-replay-01', status: 'PICKED_UP' };
      },
    );

    expect(outcome2.outcome).toBe('ACKNOWLEDGED');
    expect(keysUsed.length).toBe(2);
    expect(keysUsed[0]).toBe(keysUsed[1]); // Exact same key reused

    const all = await commandStore.listAll();
    expect(all.length).toBe(1);
    expect(all[0].attemptCount).toBe(2);
    expect(all[0].state).toBe('ACKNOWLEDGED');
  });

  it('Requirement 7: Same idempotency identity + different payload fails with IDEMPOTENCY_FINGERPRINT_MISMATCH', async () => {
    // 1. First command creates active UNKNOWN record with payload { pinCode: '1111' }
    await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-mismatch-01',
        jobId: 'job-mismatch-01',
        payload: { jobId: 'job-mismatch-01', pinCode: '1111' },
      },
      async () => {
        throw AppError.network('Timeout 504');
      },
    );

    let networkCalledOnMismatch = false;

    // 2. Second command targets same active resource but with DIFFERENT payload { pinCode: '9999' }
    await expect(
      runner.execute(
        {
          type: 'MARK_PICKED_UP',
          resourceType: 'DELIVERY_JOB',
          resourceId: 'job-mismatch-01',
          jobId: 'job-mismatch-01',
          payload: { jobId: 'job-mismatch-01', pinCode: '9999' },
        },
        async () => {
          networkCalledOnMismatch = true;
          return { id: 'job-mismatch-01' };
        },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_FINGERPRINT_MISMATCH/);

    expect(networkCalledOnMismatch).toBe(false);
  });

  it('Requirement 8: Old ACKNOWLEDGED command does not get reused for a new offer', async () => {
    let firstKey = '';
    let secondKey = '';

    // First offer accepted and ACKNOWLEDGED
    const out1 = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-1',
        payload: { offerId: 'offer-1' },
      },
      async (key) => {
        firstKey = key;
        return { offerId: 'offer-1', accepted: true };
      },
    );
    expect(out1.outcome).toBe('ACKNOWLEDGED');

    // New offer arrives later
    const out2 = await runner.execute(
      {
        type: 'ACCEPT_OFFER',
        resourceType: 'DISPATCH_OFFER',
        resourceId: 'offer-2',
        payload: { offerId: 'offer-2' },
      },
      async (key) => {
        secondKey = key;
        return { offerId: 'offer-2', accepted: true };
      },
    );
    expect(out2.outcome).toBe('ACKNOWLEDGED');

    expect(out1.commandId).not.toBe(out2.commandId);
    expect(firstKey).not.toBe(secondKey);
  });

  it('saves command as PENDING and returns PENDING when offline before send', async () => {
    connectivity.setConnected(false);

    let operationCalled = false;
    const outcome = await runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-offline-1',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-1',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-2',
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
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-double-tap',
        payload: { jobId: 'job-double-tap' },
      },
      mockOperation,
    );

    const promise2 = runner.execute(
      {
        type: 'MARK_PICKED_UP',
        resourceType: 'DELIVERY_JOB',
        resourceId: 'job-double-tap',
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
});
