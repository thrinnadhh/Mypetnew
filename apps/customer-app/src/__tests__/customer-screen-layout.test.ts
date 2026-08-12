import fs from 'node:fs';
import path from 'node:path';

const read = (relativePath: string) =>
  fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

describe('customer screen layout contracts', () => {
  test.each([
    'components/commerce/CategoryTemplate.tsx',
    'app/grooming/index.tsx',
    'components/care/ProviderCompositionTemplate.tsx',
    'screens/appointment-discovery-screen.tsx',
  ])('%s uses the shared safe-area screen shell', (relativePath) => {
    expect(read(relativePath)).toContain('<ScreenShell');
  });

  test('category header is outside the padded content area', () => {
    const source = read('components/commerce/CategoryTemplate.tsx');
    expect(source).toContain('header={');
    expect(source).toContain('contentContainerStyle={styles.shellContent}');
    expect(source).toContain('paddingHorizontal: spacing.x4');
  });

  test('grooming filters are horizontally scrollable', () => {
    const source = read('app/grooming/index.tsx');
    expect(source).toContain('horizontal');
    expect(source).toContain('showsHorizontalScrollIndicator={false}');
  });
});
