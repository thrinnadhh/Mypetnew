import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function validContract(overrides = {}) {
  const contract = {
    schema_version: 1,
    sprint: {
      id: 'agent-foundation',
      objective: 'Create deterministic engineering-agent tooling.',
      starting_sha: 'a'.repeat(40),
    },
    scope: {
      allowed_paths: ['engineering/**'],
      forbidden_paths: ['backend/src/main/**'],
      justifications: {},
    },
    workers: [
      {
        id: 'tooling',
        role: 'testing',
        objective: 'Implement and verify deterministic tooling.',
        allowed_paths: ['engineering/**'],
        forbidden_paths: ['backend/src/main/**'],
        repository_facts: ['Node 22 is already used in CI.'],
        dependencies: [],
        acceptance_criteria: ['All engineering evals pass.'],
        required_tests: ['node --test engineering/evals/*.test.mjs'],
        expected_artifacts: ['engineering/reports/certification.json'],
        evidence_requirements: ['Capture command, exit code, and duration.'],
      },
    ],
    acceptance: {
      functional: ['Contract validation is deterministic.'],
      regression: ['Existing product code is unchanged.'],
      security: ['Sprint data cannot inject shell commands.'],
      contracts: ['Reports remain machine-readable JSON.'],
    },
    certification: {
      required_checks: ['engineering_evals'],
      merge_policy: 'all_required_pass',
    },
  };

  return structuredClone(Object.assign(contract, overrides));
}

export function initGitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'mypet-engineering-eval-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'evals@mypetnew.invalid']);
  git(root, ['config', 'user.name', 'MyPet Evals']);
  return root;
}

export function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function commitFile(root, path, contents, message) {
  writeFileSync(join(root, path), contents);
  git(root, ['add', '--', path]);
  git(root, ['commit', '--quiet', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}
