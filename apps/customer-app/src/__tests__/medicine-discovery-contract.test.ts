import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('medicine discovery contract', () => {
  it('keeps Version 1 medicine discovery view-only', () => {
    const category = source('src/app/category/[id].tsx');
    const discovery = source('src/screens/commerce-discovery-screen.tsx');
    const template = source('src/components/commerce/CategoryTemplate.tsx');

    expect(discovery).toContain("{ id: 'medicines', title: 'Medicines'");
    expect(discovery).toContain("route: '/category/medicines'");
    expect(category).toContain("medicines: 'Medicines'");
    expect(category).toContain("kind: 'MEDICINE'");
    expect(category).toContain("commerceMode: 'VIEW_ONLY'");
    expect(category).toContain('medicines cannot be added to cart or purchased in MyPet');
    expect(template).toMatch(/item\.kind === 'MEDICINE' \|\| item\.commerceMode === 'VIEW_ONLY'/);
    expect(template).toContain("? 'VIEW ONLY'");
  });
});
