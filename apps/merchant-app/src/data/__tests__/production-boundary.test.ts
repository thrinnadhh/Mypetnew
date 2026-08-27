import * as fs from 'fs';
import * as path from 'path';

describe('M5 Production Boundary Guard', () => {
  it('ensures production barrel (src/data/index.ts) does not export node-driver or better-sqlite3', () => {
    const indexPath = path.resolve(__dirname, '../index.ts');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    expect(indexContent).not.toContain('node-driver');
    expect(indexContent).not.toContain('better-sqlite3');
  });

  it('ensures app root layout (_layout.tsx) does not import better-sqlite3 or node-driver', () => {
    const layoutPath = path.resolve(__dirname, '../../../app/_layout.tsx');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutContent).not.toContain('better-sqlite3');
    expect(layoutContent).not.toContain('node-driver');
  });

  it('ensures all production repositories and database files do not statically import better-sqlite3', () => {
    const dataDir = path.resolve(__dirname, '..');
    const files = fs.readdirSync(dataDir);

    for (const file of files) {
      if (file.endsWith('.ts') && !file.includes('test')) {
        const content = fs.readFileSync(path.join(dataDir, file), 'utf8');
        expect(content).not.toContain("from 'better-sqlite3'");
      }
    }
  });
});
