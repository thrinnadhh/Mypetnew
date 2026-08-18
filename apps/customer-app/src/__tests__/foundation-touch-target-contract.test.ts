import fs from 'node:fs';
import path from 'node:path';

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

describe('customer foundation touch target contract', () => {
  it('keeps shared filter chips and section actions on the canonical touch target', () => {
    const primitives = source('components/foundation/primitives.tsx');

    expect(primitives).toContain('chip: { minHeight: touchTarget');
    expect(primitives).toContain('textAction: { minHeight: touchTarget');
    expect(primitives).not.toContain('chip: { minHeight: 44');
    expect(primitives).not.toContain('textAction: { minHeight: 44');
  });
});
