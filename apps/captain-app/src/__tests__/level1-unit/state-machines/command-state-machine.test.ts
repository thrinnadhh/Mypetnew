import {
  computePayloadFingerprint,
  isTerminalOutcome,
  CommandOutcome,
  CommandType,
} from '../../../domain/command';
import { AppError } from '../../../domain/result';

describe('Level 1: Command State Machine & Deterministic Hashing Tests', () => {
  it('correctly classifies terminal and non-terminal outcomes', () => {
    const ackOutcome: CommandOutcome<{ test: boolean }> = {
      outcome: 'ACKNOWLEDGED',
      data: { test: true },
      idempotencyKey: 'idemp-1',
      commandId: 'cmd-1',
    };
    expect(isTerminalOutcome(ackOutcome)).toBe(true);

    const rejectedOutcome: CommandOutcome<never> = {
      outcome: 'REJECTED',
      error: AppError.fromHttp(400, { message: 'Invalid proof' }),
      idempotencyKey: 'idemp-2',
      commandId: 'cmd-2',
    };
    expect(isTerminalOutcome(rejectedOutcome)).toBe(true);

    const unknownOutcome: CommandOutcome<never> = {
      outcome: 'UNKNOWN',
      error: AppError.network('Network dropped'),
      idempotencyKey: 'idemp-3',
      commandId: 'cmd-3',
    };
    expect(isTerminalOutcome(unknownOutcome)).toBe(false);

    const pendingOutcome: CommandOutcome<never> = {
      outcome: 'PENDING',
      idempotencyKey: 'idemp-4',
      commandId: 'cmd-4',
    };
    expect(isTerminalOutcome(pendingOutcome)).toBe(false);
  });

  it('generates deterministic 32-bit FNV-1a payload fingerprints', () => {
    const fp1 = computePayloadFingerprint('MARK_PICKED_UP', 'job-100', { pinCode: '1234' });
    const fp2 = computePayloadFingerprint('MARK_PICKED_UP', 'job-100', { pinCode: '1234' });
    expect(fp1).toBe(fp2);
    expect(fp1.startsWith('fp-')).toBe(true);

    // Different payload produces different fingerprint
    const fp3 = computePayloadFingerprint('MARK_PICKED_UP', 'job-100', { pinCode: '5678' });
    expect(fp1).not.toBe(fp3);

    // Different command produces different fingerprint
    const fp4 = computePayloadFingerprint('MARK_DELIVERED', 'job-100', { pinCode: '1234' });
    expect(fp1).not.toBe(fp4);

    // Different job ID produces different fingerprint
    const fp5 = computePayloadFingerprint('MARK_PICKED_UP', 'job-200', { pinCode: '1234' });
    expect(fp1).not.toBe(fp5);
  });

  it('handles null, undefined, and complex nested payloads stably in fingerprinting', () => {
    const fpNull = computePayloadFingerprint('UPDATE_AVAILABILITY', null, null);
    const fpUndefined = computePayloadFingerprint('UPDATE_AVAILABILITY', undefined, undefined);
    expect(fpNull).toBe(fpUndefined);

    const fpComplex = computePayloadFingerprint('UPDATE_AVAILABILITY', null, {
      online: true,
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 10,
    });
    expect(fpComplex).toBeDefined();
    expect(fpComplex.length).toBeGreaterThan(5);
  });
});
