import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('Phase 2 customer UI contract', () => {
  it('does not leave generic route placeholders in customer detail families', () => {
    const routes = [
      'src/app/commerce/[slug].tsx',
      'src/app/guides/[slug].tsx',
      'src/app/health/[slug].tsx',
      'src/app/grooming/[slug].tsx',
      'src/app/vet/[slug].tsx',
      'src/app/details/[kind]/[id].tsx',
    ];

    for (const route of routes) {
      expect(source(route)).not.toContain('RouteFoundation');
    }
  });

  it('keeps key history screens connected to real hooks and explicit states', () => {
    const appointments = source('src/screens/appointments-screen.tsx');
    const orders = source('src/screens/orders-screen.tsx');

    expect(appointments).toContain('useAppointments()');
    expect(appointments).toContain('StateView');
    expect(appointments).toContain('accessibilityLabel');
    expect(orders).toContain('useOrders()');
    expect(orders).toContain('StateView');
    expect(orders).toContain('accessibilityLabel');
  });

  it('does not ship fake medical report URLs or fake upload success', () => {
    const reports = source('src/app/health/reports.tsx');

    expect(reports).not.toContain('storage.mypet.example');
    expect(reports).not.toContain('signed/report');
    expect(reports).not.toContain('Report uploaded successfully');
    expect(reports).toContain('prescriptionDocUrl');
  });

  it('uses the supported favourites target boundary', () => {
    const favourites = source('src/context/FavouritesContext.tsx');
    expect(favourites).toContain("'PRODUCT' | 'SHOP'");
    expect(favourites).not.toContain("'HOSPITAL'");
    expect(favourites).not.toContain("'GROOMER'");
  });
});
