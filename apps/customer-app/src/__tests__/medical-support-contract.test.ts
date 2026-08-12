import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('medical documents and support cases', () => {
  it('uses reservation upload and short-lived signed medical links', () => {
    const service = source('src/services/medical-documents.ts');
    const screen = source('src/app/health/reports.tsx');
    expect(service).toMatch(/medical-documents\/reservations/);
    expect(service).toMatch(/signed-link/);
    expect(screen).toMatch(/five-minute link/i);
    expect(screen).not.toMatch(/fake upload|permanent public/i);
  });

  it('creates customer-owned order cases and private evidence', () => {
    const service = source('src/services/customer-cases.ts');
    const screen = source('src/app/support/index.tsx');
    expect(service).toMatch(/\/api\/v1\/orders\/customer-cases/);
    expect(service).toMatch(/evidence\/reservations/);
    expect(screen).toMatch(/Missing item/);
    expect(screen).toMatch(/Damaged item/);
    expect(screen).toMatch(/Payment issue/);
    expect(screen).toMatch(/Refund:/);
  });

  it('keeps signed content private and auditable in the backend', () => {
    const medical = source('../../backend/appointment-service/src/main/kotlin/com/pawsnearme/appointmentservice/service/MedicalDocumentService.kt');
    const cases = source('../../backend/order-service/src/main/kotlin/com/pawsnearme/orderservice/service/CustomerCaseService.kt');
    expect(medical).toMatch(/SIGNED_URL_ISSUED/);
    expect(medical).toMatch(/VIEW/);
    expect(medical).toMatch(/DOWNLOAD/);
    expect(medical).toMatch(/HmacSHA256/);
    expect(cases).toMatch(/paymentModule\.refundOrder/);
    expect(cases).toMatch(/HmacSHA256/);
  });
});
