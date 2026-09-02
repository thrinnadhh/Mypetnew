import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('secret-boundary scan fails without echoing the matched credential', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-secret-scan-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps'));
  copyFileSync(fileURLToPath(new URL('../../scripts/secret-scan.sh', import.meta.url)), join(root, 'scripts', 'secret-scan.sh'));
  const credential = ['postgresql://fixture-user:', 'fixture-password@db.invalid/pets'].join('');
  writeFileSync(join(root, 'credential.txt'), `${credential}\n`);

  const result = spawnSync('bash', ['scripts/secret-scan.sh'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Potential server credential/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /fixture-password|postgresql:\/\//);
});

test('secret-boundary scan fails closed when a scanner cannot complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-secret-scan-error-'));
  mkdirSync(join(root, 'scripts'));
  copyFileSync(fileURLToPath(new URL('../../scripts/secret-scan.sh', import.meta.url)), join(root, 'scripts', 'secret-scan.sh'));

  const result = spawnSync('bash', ['scripts/secret-scan.sh'], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /scanner failed before completing/);
  assert.doesNotMatch(result.stdout, /scan passed/);
});

test('environment-template scan fails closed when grep cannot complete', () => {
  const root = mkdtempSync(join(tmpdir(), 'mypet-secret-template-error-'));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'apps'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(fileURLToPath(new URL('../../scripts/secret-scan.sh', import.meta.url)), join(root, 'scripts', 'secret-scan.sh'));
  writeFileSync(join(root, '.env.example'), 'DATABASE_PASSWORD=replace-example-password\n');
  writeFileSync(join(root, 'bin', 'rg'), '#!/usr/bin/env bash\nexit 1\n');
  writeFileSync(join(root, 'bin', 'grep'), '#!/usr/bin/env bash\nexit 2\n');
  chmodSync(join(root, 'bin', 'rg'), 0o700);
  chmodSync(join(root, 'bin', 'grep'), 0o700);

  const result = spawnSync('/bin/bash', ['scripts/secret-scan.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: `${join(root, 'bin')}:/usr/bin:/bin` },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Environment template scanner failed/);
  assert.doesNotMatch(result.stdout, /scan passed/);
});
