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
    expect(service).toMatch(/\/api\/v1\/customer\/recurring-orders/);
    expect(service).not.toMatch(/\/api\/v1\/orders\/subscriptions/);
  });

  it('keeps the server authoritative for ownership, cadence and current-price revalidation', () => {
    const controller = source('../../backend/src/main/kotlin/in/mypetnew/application/web/CustomerRecurringOrderController.kt');
    const backend = source('../../backend/src/main/kotlin/in/mypetnew/recurring/domain/RecurringOrderService.kt');
    const migration = source('../../backend/src/main/resources/db/migration/V20__customer_recurring_orders.sql');

    expect(controller).toContain('Authorizer.requireRole(principal, Role.CUSTOMER)');
    expect(controller).toContain('customer(authentication)');
    expect(backend).toContain('orders.detail(customerId, sourceOrderId)');
    expect(backend).toContain('ALLOWED_CADENCES = setOf(7, 15, 25, 30, 35)');
    expect(backend).toContain('listing?.sellingPricePaise ?: line.unitPricePaise');
    expect(backend).toContain('status = RecurringOrderStatus.AWAITING_CONFIRMATION');
    expect(migration).toContain("WHERE status <> 'CANCELLED'");
  });

  it('preserves D-019 explicit confirmation and no automatic charging', () => {
    const decisions = source('../../docs/product/DECISIONS.md');
    expect(decisions).toContain('D-019');
    expect(decisions).toContain('7, 15, 25, 30, and 35 days');
    expect(decisions).toContain('No automatic COD placement or payment mandate charge occurs');
  });
});
