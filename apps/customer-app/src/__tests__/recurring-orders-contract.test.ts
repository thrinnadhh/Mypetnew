import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecurringCadence, RECURRING_CADENCES } from '../contracts/recurring-orders';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('recurring order contract', () => {
  it('limits cadence to the approved intervals', () => {
    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    expect(isRecurringCadence(25)).toBe(true);
    expect(isRecurringCadence(10)).toBe(false);
  });

  it('requires customer confirmation and a fresh checkout', () => {
    const screen = source('src/app/subscriptions/index.tsx');
    const service = source('src/services/recurring-orders.ts');
    expect(screen).toMatch(/No silent charging/);
    expect(screen).toMatch(/Revalidate and confirm/);
    expect(screen).toMatch(/router\.push\('\/cart'/);
    expect(service).toMatch(/\/api\/v1\/orders\/subscriptions/);
  });

  it('verifies recurring order specification D-019 requires explicit customer confirmation and limits cadences', () => {
    const decisions = source('../../docs/product/DECISIONS.md');
    const matrix = source('../../docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md');

    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    expect(decisions).toContain('D-019');
    expect(decisions).toContain('7, 15, 25, 30, and 35 days');
    expect(decisions).toContain('No automatic COD placement or payment mandate charge occurs');
    expect(matrix).toContain('### 2.6.2 Recurring Orders & Subscriptions (`DEFERRED`)');
    expect(matrix).toContain('| Recurring Subscriptions | POST | `/api/v1/orders/subscriptions` (Legacy client route) | N/A (Sprint 1 uses single-order pickup) | **DEFERRED** | Post-Sprint 1 |');
  });
});
