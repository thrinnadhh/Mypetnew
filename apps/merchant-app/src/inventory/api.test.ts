import * as Crypto from 'expo-crypto';
import { merchantApiFetch } from '../auth/session';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  submitInventoryAdjustment,
} from './api';

jest.mock('../auth/session', () => ({ merchantApiFetch: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => 'inventory-command-uuid') }));

const fetchMock = merchantApiFetch as jest.MockedFunction<typeof merchantApiFetch>;
const uuidMock = Crypto.randomUUID as jest.MockedFunction<typeof Crypto.randomUUID>;

function response(ok: boolean, body: unknown): Response {
  return { ok, json: jest.fn().mockResolvedValue(body) } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  uuidMock.mockReturnValue('inventory-command-uuid');
});

describe('Merchant M3 inventory client', () => {
  it('creates one immutable command identity for a logical adjustment', () => {
    const command = createInventoryAdjustmentCommand({
      outletId: 'outlet-1',
      listingId: 'listing-1',
      quantityDelta: -2,
      reason: 'MANUAL_DECREASE',
      referenceType: 'MERCHANT_NOTE',
      referenceId: 'damaged-during-audit',
    });

    expect(command.idempotencyKey).toBe('inventory-adjust:inventory-command-uuid');
    expect(command.input.quantityDelta).toBe(-2);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.input)).toBe(true);
  });

  it('reuses the exact idempotency key when a lost-response command is submitted again', async () => {
    const movement = {
      id: 'movement-1',
      listingId: 'listing-1',
      reason: 'MANUAL_INCREASE',
      quantityDelta: 3,
      resultingOnHand: 8,
      resultingReserved: 0,
      sourceReference: 'inventory-adjust:inventory-command-uuid',
      occurredAt: '2026-08-22T00:00:00Z',
    };
    fetchMock
      .mockRejectedValueOnce(new TypeError('network response was lost'))
      .mockResolvedValueOnce(response(true, movement));

    const command = createInventoryAdjustmentCommand({
      outletId: 'outlet-1',
      listingId: 'listing-1',
      quantityDelta: 3,
      reason: 'MANUAL_INCREASE',
    });

    await expect(submitInventoryAdjustment(command)).rejects.toThrow('network response was lost');
    await expect(submitInventoryAdjustment(command)).resolves.toEqual(movement);

    expect(uuidMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual(fetchMock.mock.calls[1]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/merchant/inventory/adjustments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'inventory-adjust:inventory-command-uuid' },
      body: JSON.stringify(command.input),
    });
  });

  it('loads a tenant-targeted balance and bounded deterministic movement page', async () => {
    fetchMock
      .mockResolvedValueOnce(response(true, {
        organizationId: 'org-1',
        outletId: 'outlet-1',
        listingId: 'listing-1',
        onHand: 7,
        reserved: 2,
        available: 5,
        version: 4,
        updatedAt: '2026-08-22T00:00:00Z',
      }))
      .mockResolvedValueOnce(response(true, { items: [], page: 2, pageSize: 10, hasNext: false }));

    await fetchInventoryBalance('outlet-1', 'listing-1');
    await fetchInventoryMovements('outlet-1', 'listing-1', 2, 10);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/v1/merchant/inventory/balance?outletId=outlet-1&listingId=listing-1',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/merchant/inventory/movements?outletId=outlet-1&listingId=listing-1&page=2&pageSize=10',
    );
  });

  it.each([
    ['adjustment', async () => submitInventoryAdjustment(createInventoryAdjustmentCommand({ outletId: 'outlet-1', listingId: 'listing-1', quantityDelta: 1, reason: 'MANUAL_INCREASE' }))],
    ['balance', async () => fetchInventoryBalance('outlet-1', 'listing-1')],
    ['history', async () => fetchInventoryMovements('outlet-1', 'listing-1')],
  ] as const)('surfaces the canonical server error contract for %s', async (_name, operation) => {
    fetchMock.mockResolvedValue(response(false, { code: 'INVENTORY_PERMISSION_REQUIRED', message: 'Inventory access denied' }));
    await expect(operation()).rejects.toMatchObject({ name: 'INVENTORY_PERMISSION_REQUIRED', message: 'Inventory access denied' });
  });
});
