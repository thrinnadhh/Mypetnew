import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('customer route destination regressions', () => {
  it('keeps the appointment list destination reachable from home and booking confirmation', () => {
    const appointmentsRoute = 'src/app/appointments/index.tsx';
    const route = source(appointmentsRoute);
    const home = source('src/screens/home-screen.tsx');
    const payment = source('src/app/appointments/payment.tsx');

    expect(existsSync(join(process.cwd(), appointmentsRoute))).toBe(true);
    expect(route).toMatch(/screens\/appointments-screen/);
    expect(home).toContain('/appointments');
    expect(payment).toContain('/appointments?appointmentId=');
  });

  it('keeps successful product payment navigation backed by the order-detail route', () => {
    const orderDetailRoute = 'src/app/orders/[id].tsx';
    const checkout = source('src/app/checkout/index.tsx');

    expect(existsSync(join(process.cwd(), orderDetailRoute))).toBe(true);
    expect(checkout).toMatch(/router\.replace\(`\/orders\/\$\{orderId\}`/);
  });
});
