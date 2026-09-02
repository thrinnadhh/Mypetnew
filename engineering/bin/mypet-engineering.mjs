#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { analyzeFileHistory } from '../lib/archaeology.mjs';
import { CHECK_CATALOG, certify, runChecks, selectChecks } from '../lib/certifier.mjs';
import { isSafeRepositoryPath, validateSprintContract } from '../lib/contract.mjs';
import { analyzeRepositoryDependencies, repositoryRoot, resolveRevision } from '../lib/repository.mjs';
import { collectGitChanges, evaluateScope } from '../lib/scope.mjs';

function parseArguments(tokens) {
  const options = {};
  const positional = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const key = token.slice(2);
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`Invalid option: ${token}`);
    if (key === 'run') {
      options.run = true;
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    options[key] = value;
    index += 1;
  }
  return { options, positional };
}

function safeRepoFile(root, path) {
  if (!isSafeRepositoryPath(path)) throw new Error(`Path must be safe and repository-relative: ${path}`);
  const absolute = resolve(root, path);
  if (!(absolute === root || absolute.startsWith(`${root}/`))) throw new Error(`Path escapes repository: ${path}`);
  return absolute;
}

function loadContract(root, path) {
  const content = readFileSync(safeRepoFile(root, path), 'utf8');
  if (content.length > 1024 * 1024) throw new Error('Sprint contract exceeds the 1 MiB limit.');
  return JSON.parse(content);
}

function emit(root, report, output) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    const absolute = safeRepoFile(root, output);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, { mode: 0o600 });
  } else {
    process.stdout.write(content);
  }
}

function contractReport(contract, changedPaths = []) {
  const report = validateSprintContract(contract, {
    changedPaths,
    knownCheckIds: CHECK_CATALOG.map(({ id }) => id),
  });
  return { schema_version: 1, report_type: 'contract', ...report };
}

function securityReportFor(results, headSha, executed) {
  if (!executed) return { status: 'BLOCKED', summary: 'Security check was planned but not executed.' };
  const result = results.find(({ id }) => id === 'security_scan');
  if (!result) return { status: 'FAIL', summary: 'Required security check evidence is missing.' };
  return {
    status: result.status === 'PASS' && result.head_sha === headSha ? 'PASS' : 'FAIL',
    summary: result.status === 'PASS' ? 'Repository secret scan passed at the exact head.' : 'Repository secret scan failed.',
    check_id: result.id,
    output_file: result.output_file,
    output_sha256: result.output_sha256,
  };
}

function usage() {
  return `Usage:\n  mypet-engineering contract validate --contract <path> [--output <path>]\n  mypet-engineering scope --contract <path> [--head HEAD] [--output <path>]\n  mypet-engineering dependency --base <sha> [--head HEAD] [--output <path>]\n  mypet-engineering archaeology --path <path> [--max-commits 100] [--output <path>]\n  mypet-engineering certify --contract <path> [--head HEAD] [--run] [--output <path>]\n`;
}

function main() {
  const root = repositoryRoot();
  const { options, positional } = parseArguments(process.argv.slice(2));
  const command = positional.join(' ');

  if (command === 'contract validate') {
    if (!options.contract) throw new Error('--contract is required.');
    const report = contractReport(loadContract(root, options.contract));
    emit(root, report, options.output);
    return report.valid ? 0 : 2;
  }

  if (command === 'scope') {
    if (!options.contract) throw new Error('--contract is required.');
    const contract = loadContract(root, options.contract);
    const validation = contractReport(contract);
    if (!validation.valid) {
      emit(root, validation, options.output);
      return 2;
    }
    const baseSha = resolveRevision(root, contract.sprint.starting_sha);
    const headSha = resolveRevision(root, options.head ?? 'HEAD');
    const changes = collectGitChanges({ repoRoot: root, base: baseSha, head: headSha });
    const report = { schema_version: 1, report_type: 'scope', base_sha: baseSha, head_sha: headSha, ...evaluateScope({ contract, changes }) };
    emit(root, report, options.output);
    return report.status === 'FAIL' ? 2 : 0;
  }

  if (command === 'dependency') {
    if (!options.base) throw new Error('--base is required.');
    const report = analyzeRepositoryDependencies({ repoRoot: root, base: options.base, head: options.head ?? 'HEAD' });
    emit(root, report, options.output);
    return report.status === 'FAIL' ? 2 : 0;
  }

  if (command === 'archaeology') {
    if (!options.path) throw new Error('--path is required.');
    const report = {
      schema_version: 1,
      report_type: 'archaeology',
      ...analyzeFileHistory({ repoRoot: root, path: options.path, maxCommits: Number(options['max-commits'] ?? 100) }),
    };
    emit(root, report, options.output);
    return report.status === 'success' ? 0 : 2;
  }

  if (command === 'certify') {
    if (!options.contract) throw new Error('--contract is required.');
    const contract = loadContract(root, options.contract);
    const headSha = resolveRevision(root, options.head ?? 'HEAD');
    const baseSha = resolveRevision(root, contract.sprint?.starting_sha ?? 'invalid');
    const changes = collectGitChanges({ repoRoot: root, base: baseSha, head: headSha });
    const changedFiles = changes.map(({ path }) => path);
    const validation = contractReport(contract, changedFiles);
    if (!validation.valid) {
      emit(root, validation, options.output);
      return 2;
    }
    const selected = selectChecks(changedFiles);
    const requiredIds = new Set([...contract.certification.required_checks, ...selected.map(({ id }) => id)]);
    const checks = CHECK_CATALOG.filter(({ id }) => requiredIds.has(id));
    const missingIds = [...requiredIds].filter((id) => !checks.some((check) => check.id === id));
    if (missingIds.length > 0) throw new Error(`Unknown required check IDs: ${missingIds.join(', ')}`);
    const outputDirectory = `evidence/generated/engineering/${contract.sprint.id}/${headSha}`;
    const results = options.run ? runChecks({ repoRoot: root, checks, outputDirectory, headSha }) : [];
    const scope = evaluateScope({ contract, changes });
    const dependencies = analyzeRepositoryDependencies({ repoRoot: root, base: baseSha, head: headSha });
    const security = securityReportFor(results, headSha, options.run === true);
    const report = {
      schema_version: 1,
      report_type: 'certification',
      selected_checks: checks.map(({ id, category, cwd }) => ({ id, category, cwd })),
      ...certify({
        startingSha: baseSha,
        currentSha: headSha,
        changedFiles,
        requiredCheckIds: [...requiredIds],
        checkResults: results,
        scopeReport: scope,
        dependencyReport: dependencies,
        securityReport: security,
      }),
    };
    emit(root, report, options.output ?? (options.run ? `${outputDirectory}/certification.json` : undefined));
    return report.final === 'CERTIFIED' ? 0 : 3;
  }

  process.stderr.write(usage());
  return 1;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
}
