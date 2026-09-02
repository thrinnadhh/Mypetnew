import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./prepare-preview-branch-env.mjs', import.meta.url);

function runCase(source, parentRef = 'parentref') {
  const dir = mkdtempSync(join(tmpdir(), 'mypet-preview-env-'));
  const input = join(dir, 'branch.env');
  const output = join(dir, 'github.env');
  writeFileSync(input, source, 'utf8');
  const result = spawnSync(process.execPath, [script.pathname, input, output], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_ENV: output,
      SUPABASE_PARENT_PROJECT_REF: parentRef,
    },
  });
  const envText = result.status === 0 ? readFileSync(output, 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { ...result, envText };
}

test('prepares JDBC and psql variables for an isolated preview project', () => {
  const result = runCase(
    'POSTGRES_URL_NON_POOLING=postgresql://postgres.previewref:p%40ss@db.previewref.supabase.co:5432/postgres?sslmode=require\nSUPABASE_PROJECT_REF=previewref\n',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.envText, /PREVIEW_PROJECT_REF=previewref/);
  assert.match(result.envText, /PREVIEW_JDBC_URL=jdbc:postgresql:\/\/db\.previewref\.supabase\.co:5432\/postgres\?sslmode=require/);
  assert.match(result.envText, /PREVIEW_DB_USER=postgres\.previewref/);
  assert.match(result.envText, /PREVIEW_DB_PASSWORD=p@ss/);
});

test('fails closed when branch credentials point at the parent project', () => {
  const result = runCase(
    'POSTGRES_URL_NON_POOLING=postgresql://postgres.parentref:secret@db.parentref.supabase.co:5432/postgres?sslmode=require\n',
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /refusing to run preview certification against the parent Supabase project/);
});

test('rejects pooler or non-Supabase hosts for preview migration', () => {
  const result = runCase(
    'POSTGRES_URL_NON_POOLING=postgresql://postgres.previewref:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres\n',
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /direct Supabase host/);
});
