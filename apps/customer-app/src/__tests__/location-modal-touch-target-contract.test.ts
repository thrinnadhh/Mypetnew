import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('location selector touch-target contract', () => {
  it('uses the canonical touch target for interactive location controls', () => {
    const modal = source('src/components/location-modal.tsx');

    expect(modal).toContain("import { radii, spacing, touchTarget, typography } from '@/design/tokens'");
    expect(modal).toMatch(/closeBtn:\s*\{[^}]*minWidth:\s*touchTarget[^}]*minHeight:\s*touchTarget/);
    expect(modal).toMatch(/searchBar:\s*\{[^}]*height:\s*touchTarget/);
    expect(modal).toMatch(/searchInput:\s*\{[^}]*height:\s*touchTarget/);
    expect(modal).toMatch(/notifyBtn:\s*\{[^}]*minHeight:\s*touchTarget/);
    expect(modal).toMatch(/input:\s*\{[^}]*height:\s*touchTarget/);
    expect(modal).toMatch(/modalBtn:\s*\{[^}]*minHeight:\s*touchTarget/);
  });
});
