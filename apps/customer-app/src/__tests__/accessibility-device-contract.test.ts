import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('customer accessibility and device contract', () => {
  it('retains at least 48 px interactive targets', () => {
    const tokens = source('src/design/tokens.ts');
    const screenHeader = source('src/components/ui/screen-header.tsx');
    const primaryButton = source('src/components/ui/primary-button.tsx');

    expect(tokens).toMatch(/touchTarget\s*=\s*48/);
    expect(screenHeader).toContain("import { touchTarget } from '@/design/tokens'");
    expect(screenHeader).toMatch(/width:\s*touchTarget/);
    expect(screenHeader).toMatch(/height:\s*touchTarget/);
    expect(primaryButton).toContain("import { touchTarget } from '@/design/tokens'");
    expect(primaryButton).toMatch(/minimumTouchTarget:\s*\{[\s\S]*minHeight:\s*touchTarget/);
    expect(primaryButton).toMatch(/style,[\s\n]*styles\.minimumTouchTarget/);
  });

  it('supports bounded responsive screens and pull to refresh', () => {
    const shell = source('src/components/foundation/screen-shell.tsx');
    expect(shell).toMatch(/MaxContentWidth/);
    expect(shell).toMatch(/refreshControl/);
    expect(shell).toMatch(/KeyboardAvoidingView/);
  });

  it('labels critical upload and support actions', () => {
    const reports = source('src/app/health/reports.tsx');
    const support = source('src/app/support/index.tsx');
    expect(reports).toMatch(/accessibilityLabel="Upload a medical report"/);
    expect(reports).toMatch(/accessibilityRole="button"/);
    expect(support).toMatch(/Support cases are restricted to the customer/);
  });

  it('does not disable font scaling on customer text primitives', () => {
    const themedText = source('src/components/themed-text.tsx');
    expect(themedText).not.toMatch(/allowFontScaling=\{false\}/);
    expect(themedText).not.toMatch(/maxFontSizeMultiplier=\{1\}/);
  });
});
