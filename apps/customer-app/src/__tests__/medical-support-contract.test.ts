import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function expectAll(content: string, values: string[]) {
  for (const value of values) expect(content).toContain(value);
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

  it('verifies private storage policy DD-012 and document upload boundaries while medical/support services remain deferred', () => {
    const verificationBackend = source('../../backend/src/main/kotlin/in/mypetnew/application/web/VerificationDocumentController.kt');
    const decisions = source('../../docs/product/DECISIONS.md');
    const matrix = source('../../docs/architecture/CUSTOMER_API_COMPATIBILITY_MATRIX.md');

    expect(verificationBackend).toContain('class VerificationDocumentController');
    expect(verificationBackend).toContain('verification-documents');

    expectAll(decisions, [
      'DD-012',
      'Private merchant-verification, medical, support, and proof objects use private Supabase Storage buckets',
      'short-lived, purpose-bound signed access',
    ]);
    expect(matrix).toContain('- **2.6.3 Medical Documents (`DEFERRED`)**:');
    expect(matrix).toContain('| Medical Documents | POST/GET | `/api/v1/medical-documents/reservations` (Legacy client route) | N/A (Backend service deferred; DD-012 private storage active) | **DEFERRED** | Post-Sprint 1 |');
    expect(matrix).toContain('- **2.6.4 Support Cases (`DEFERRED`)**:');
    expect(matrix).toContain('| Customer Support Cases | POST | `/api/v1/orders/customer-cases` (Legacy client route) | N/A (Backend case service deferred) | **DEFERRED** | Post-Sprint 1 |');
  });

  it('pins every deferred capability to a fail-closed registry entry with dev-only overrides', () => {
    const registry = source('src/services/backend-capabilities.ts');
    const medical = source('src/services/medical-documents.ts');
    const cases = source('src/services/customer-cases.ts');

    for (const id of ['medicalDocuments', 'supportCases', 'chat', 'contentEngagement', 'vaccinationReminders', 'localeSync']) {
      expect(registry).toContain(`${id}: { id: '${id}', available: false`);
    }
    expect(registry).toMatch(/__DEV__ && isTruthy\(process\.env\[entry\.envOverride\]\)/);
    expect(registry).toContain('DD-012');

    // Services must assert the registry before any network or URL work.
    expect(medical.indexOf("assertCapabilityAvailable('medicalDocuments');")).toBeGreaterThan(-1);
    expect(medical).toMatch(/export (async )?function fetchMedicalDocuments[\s\S]*?assertCapabilityAvailable\('medicalDocuments'\);[\s\S]*?apiClient\.get/);
    expect(cases).toMatch(/export (async )?function fetchCustomerCases[\s\S]*?assertCapabilityAvailable\('supportCases'\);[\s\S]*?apiClient\.get/);
  });
});
