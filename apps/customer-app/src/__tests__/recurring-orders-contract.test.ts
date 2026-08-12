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

  it('keeps the scheduler confirmation-only', () => {
    const backend = source('../../backend/order-service/src/main/kotlin/com/pawsnearme/orderservice/service/RecurringOrderService.kt');
    const migration = source('../../backend/order-service/src/main/resources/db/migration/V1001__p2b_recurring_orders.sql');
    expect(backend).toMatch(/RecurringOrderConfirmationRequired/);
    expect(backend).toMatch(/automaticCharge" to false/);
    expect(backend).toMatch(/revalidateReorder/);
    expect(backend).not.toMatch(/orderService\.createOrder/);
    expect(migration).toMatch(/7, 15, 25, 30, 35/);
  });
});
