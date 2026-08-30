import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(repoRoot, 'scripts/supabase/export-free-tier-backup.sh');

function executable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

test('backup keeps mypet and legacy Captain selections in separate archives', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-backup-test-'));
  const bin = join(root, 'bin');
  const backupRoot = join(root, 'backups');
  const callLog = join(root, 'pg-dump-calls.txt');
  mkdirSync(bin);

  executable(join(bin, 'psql'), `#!/usr/bin/env bash
printf '%s\n' 'database=postgres' 'flyway_latest=21' 'flyway_failed=0' 'mypet_tables=68'
`);
  executable(join(bin, 'pg_dump'), `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CALL_LOG"
out=''
for arg in "$@"; do
  case "$arg" in --file=*) out="\${arg#--file=}" ;; esac
done
[[ -n "$out" ]] || exit 2
printf 'fake custom archive\n' > "$out"
`);

  executable(join(bin, 'pg_restore'), `#!/usr/bin/env bash
[[ "$1" == '--list' ]] || exit 2
printf 'fake restore list\n'
`);

  executable(join(bin, 'shasum'), `#!/usr/bin/env bash
shift 2
for file in "$@"; do printf 'deadbeef  %s\n' "$file"; done
`);

  const result = spawnSync('bash', [script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      CALL_LOG: callLog,
      SUPABASE_DATABASE_URL: 'postgresql://example.invalid/postgres',
      BACKUP_ROOT: backupRoot,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const calls = readFileSync(callLog, 'utf8').trim().split('\n');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /--schema=mypet/);
  assert.doesNotMatch(calls[0], /--table=public\.captain_/);
  assert.doesNotMatch(calls[1], /--schema=mypet/);
  for (const table of ['captain_locations', 'captain_onboarding', 'captain_support_tickets']) {
    assert.match(calls[1], new RegExp(`--table=public\\.${table}`));
  }

  const backupDirs = readdirSync(backupRoot);
  assert.equal(backupDirs.length, 1);
  const output = join(backupRoot, backupDirs[0]);
  for (const name of [
    'petshop-staging-mypet.dump',
    'petshop-staging-legacy-captain.dump',
    'restore-list-mypet.txt',
    'restore-list-legacy-captain.txt',
    'baseline.txt',
    'SHA256SUMS',
  ]) assert.equal(existsSync(join(output, name)), true, name);
});
