import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isRecurringCadence, RECURRING_CADENCES } from '../contracts/recurring-orders';

function safeSource(path: string): string {
  const fullPath = join(process.cwd(), path);
  return existsSync(fullPath) ? readFileSync(fullPath, 'utf8') : '';
}

describe('recurring order contract', () => {
  it('limits cadence to the approved intervals', () => {
    expect(RECURRING_CADENCES).toEqual([7, 15, 25, 30, 35]);
    expect(isRecurringCadence(25)).toBe(true);
    expect(isRecurringCadence(10)).toBe(false);
  });

  it('requires customer confirmation and a fresh checkout', () => {
    const screen = safeSource('src/app/subscriptions/index.tsx');
    const service = safeSource('src/services/recurring-orders.ts');
    expect(screen).toMatch(/No silent charging/);
    expect(screen).toMatch(/Revalidate and confirm/);
    expect(screen).toMatch(/router\.push\('\/cart'/);
    expect(service).toMatch(/\/api\/v1\/orders\/subscriptions/);
  });

  it('keeps the scheduler confirmation-only', () => {
    const backend = safeSource('../../backend/order-service/src/main/kotlin/com/pawsnearme/orderservice/service/RecurringOrderService.kt');
    const migration = safeSource('../../backend/order-service/src/main/resources/db/migration/V1001__p2b_recurring_orders.sql');
    if (backend) {
      expect(backend).toMatch(/RecurringOrderConfirmationRequired/);
      expect(backend).toMatch(/automaticCharge" to false/);
      expect(backend).toMatch(/revalidateReorder/);
      expect(backend).not.toMatch(/orderService\.createOrder/);
    }
    if (migration) {
      expect(migration).toMatch(/7, 15, 25, 30, 35/);
    }
  });
});
