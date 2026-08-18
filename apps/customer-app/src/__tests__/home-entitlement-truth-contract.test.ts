import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('home entitlement truth contract', () => {
  it('does not claim Premium status without a real entitlement source', () => {
    const home = source('src/screens/home-screen.tsx');

    expect(home).not.toContain('>Premium</ThemedText>');
    expect(home).not.toContain('styles.premiumPill');
    expect(home).not.toContain('styles.premiumText');
  });
});
