import { CommandRunner } from '../../sync/command-runner';
import { commandStore } from '../../sync/command-store';
import { AppError } from '../../domain/result';
import { CommandType } from '../../domain/command';

describe('Level 5: Comprehensive Mutation Coverage Matrix', () => {
  let runner: CommandRunner;

  beforeEach(async () => {
    runner = new CommandRunner();
    await commandStore.clear();
  });

  const operationalMutations: {
    type: CommandType;
    jobId: string | null;
    payload: any;
  }[] = [
    {
      type: 'UPDATE_AVAILABILITY',
      jobId: null,
      payload: { online: true, latitude: 13.6288, longitude: 79.4192 },
    },
    {
      type: 'ACCEPT_OFFER',
      jobId: 'job-mut-001',
      payload: { offerId: 'off-mut-001' },
    },
    {
      type: 'REJECT_OFFER',
      jobId: 'job-mut-002',
      payload: { offerId: 'off-mut-002' },
    },
    {
      type: 'MARK_PICKED_UP',
      jobId: 'job-mut-003',
      payload: { jobId: 'job-mut-003', pinCode: '1234' },
    },
    {
      type: 'MARK_DELIVERED',
      jobId: 'job-mut-004',
      payload: { jobId: 'job-mut-004', pinCode: '5678' },
    },
  ];

  operationalMutations.forEach(({ type, jobId, payload }) => {
    describe(`Mutation: ${type}`, () => {
      it('1. Success lifecycle -> ACKNOWLEDGED outcome and persisted record', async () => {
        const outcome = await runner.execute({ type, jobId, payload }, async (_key) => {
          return { success: true, timestamp: '2026-08-23T12:00:00Z' };
        });

        expect(outcome.outcome).toBe('ACKNOWLEDGED');
        const record = await commandStore.get(outcome.commandId);
        expect(record?.state).toBe('ACKNOWLEDGED');
        expect(record?.attemptCount).toBe(1);
      });

      it('2. Deterministic Rejection -> REJECTED outcome and terminal state', async () => {
        const outcome = await runner.execute({ type, jobId, payload }, async () => {
          throw AppError.fromHttp(400, { code: 'VALIDATION_FAILED', message: 'Rejected by validation' });
        });

        expect(outcome.outcome).toBe('REJECTED');
        if (outcome.outcome === 'REJECTED') {
          expect(outcome.error.kind).toBe('ValidationRejected');
        }

        const pending = await commandStore.listPending();
        expect(pending.length).toBe(0); // Terminal, no retry
      });

      it('3. Timeout / Network Drop -> UNKNOWN outcome and pending store entry', async () => {
        const outcome = await runner.execute({ type, jobId, payload }, async () => {
          throw AppError.timeout('Server timed out');
        });

        expect(outcome.outcome).toBe('UNKNOWN');
        if (outcome.outcome === 'UNKNOWN') {
          expect(outcome.error.kind).toBe('Timeout');
        }

        const pending = await commandStore.listPending();
        expect(pending.length).toBe(1);
        expect(pending[0].state).toBe('UNKNOWN');
      });

      it('4. Retry lifecycle -> preserves exact same idempotencyKey across attempts', async () => {
        const keys: string[] = [];

        // Attempt 1: Fails with network drop
        await runner.execute({ type, jobId, payload }, async (key) => {
          keys.push(key);
          throw AppError.network('Drop 1');
        });

        // Attempt 2: Succeeds
        const outcome2 = await runner.execute({ type, jobId, payload }, async (key) => {
          keys.push(key);
          return { success: true };
        });

        expect(outcome2.outcome).toBe('ACKNOWLEDGED');
        expect(keys.length).toBe(2);
        expect(keys[0]).toBe(keys[1]); // Exact same key used
      });

      it('5. Duplicate / Idempotency -> coalesces concurrent in-flight executions', async () => {
        let invocations = 0;
        const delayedCall = async () => {
          invocations++;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: true };
        };

        const p1 = runner.execute({ type, jobId, payload }, delayedCall);
        const p2 = runner.execute({ type, jobId, payload }, delayedCall);

        const [r1, r2] = await Promise.all([p1, p2]);

        expect(invocations).toBe(1);
        expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
        expect(r1.commandId).toBe(r2.commandId);
      });
    });
  });
});
