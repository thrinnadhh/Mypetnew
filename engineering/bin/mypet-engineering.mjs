#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { analyzeFileHistory } from '../lib/archaeology.mjs';
import { CHECK_CATALOG, certify, runChecks, selectChecks } from '../lib/certifier.mjs';
import { isSafeRepositoryPath, validateSprintContract } from '../lib/contract.mjs';
import { analyzeRepositoryDependencies, assertAncestor, repositoryRoot, resolveRevision, workingTreePaths } from '../lib/repository.mjs';
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
      if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${token}`);
      options.run = true;
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${token}`);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate option: ${token}`);
    options[key] = value;
    index += 1;
  }
  return { options, positional };
}

function safeRepoFile(root, path) {
  if (!isSafeRepositoryPath(path)) throw new Error(`Path must be safe and repository-relative: ${path}`);
  const absolute = resolve(root, path);
  const relationship = relative(root, absolute);
  if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error(`Path escapes repository: ${path}`);
  return absolute;
}

function loadContract(root, path) {
  const lexicalPath = safeRepoFile(root, path);
  const metadata = lstatSync(lexicalPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('Sprint contract must be a regular file, not a symlink.');
  if (metadata.size > 1024 * 1024) throw new Error('Sprint contract exceeds the 1 MiB limit.');
  const realPath = realpathSync(lexicalPath);
  const relationship = relative(realpathSync(root), realPath);
  if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('Sprint contract resolves outside the repository.');
  const content = readFileSync(realPath, 'utf8');
  return JSON.parse(content);
}

function ensureSafeOutputDirectory(root, targetDirectory) {
  const realRoot = realpathSync(root);
  const missingSegments = [];
  let cursor = targetDirectory;
  while (true) {
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Report output parent must be a real directory, not a symlink.');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = dirname(cursor);
      if (parent === cursor) throw new Error('Unable to find a safe report output ancestor.');
      missingSegments.unshift(basename(cursor));
      cursor = parent;
    }
  }
  let realCursor = realpathSync(cursor);
  let relationship = relative(realRoot, realCursor);
  if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('Report output directory resolves outside the repository.');
  for (const segment of missingSegments) {
    const next = resolve(realCursor, segment);
    mkdirSync(next, { mode: 0o700 });
    const metadata = lstatSync(next);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Report output directory creation was redirected.');
    realCursor = realpathSync(next);
    relationship = relative(realRoot, realCursor);
    if (relationship.startsWith('..') || isAbsolute(relationship)) throw new Error('Report output directory resolves outside the repository.');
  }
  return realCursor;
}

function emit(root, report, output) {
  const content = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    if (!output.startsWith('evidence/generated/') || !output.endsWith('.json')) {
      throw new Error('Report output must be a JSON file under evidence/generated/.');
    }
    const absolute = safeRepoFile(root, output);
    const realParent = ensureSafeOutputDirectory(root, dirname(absolute));
    const finalPath = resolve(realParent, basename(absolute));
    const temporaryPath = resolve(realParent, `.${basename(absolute)}.${process.pid}.${randomUUID()}.tmp`);
    const descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      writeFileSync(descriptor, content);
    } finally {
      closeSync(descriptor);
    }
    try {
      renameSync(temporaryPath, finalPath);
    } catch (error) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original atomic-replace error.
      }
      throw error;
    }
  } else {
    process.stdout.write(content);
  }
}

function assertOptions(options, allowed) {
  for (const option of Object.keys(options)) if (!allowed.has(option)) throw new Error(`Unsupported option for this command: --${option}`);
}

function contractReport(contract, changedPaths = []) {
  const report = validateSprintContract(contract, {
    changedPaths,
    knownCheckIds: CHECK_CATALOG.map(({ id }) => id),
  });
  return { schema_version: 1, report_type: 'contract', ...report };
}

function securityReportFor(results, headSha, executed) {
  if (!executed) return { report_type: 'secret_scan', status: 'BLOCKED', summary: 'The narrow repository secret-pattern scan was planned but not executed.' };
  const result = results.find(({ id }) => id === 'security_scan');
  if (!result) return { report_type: 'secret_scan', status: 'FAIL', summary: 'Required secret-pattern scan evidence is missing.' };
  return {
    report_type: 'secret_scan',
    status: result.status === 'PASS' && result.head_sha === headSha ? 'PASS' : 'FAIL',
    summary: result.status === 'PASS' ? 'The narrow repository secret-pattern scan passed at the exact head.' : 'The repository secret-pattern scan failed.',
    check_id: result.id,
    output_file: result.output_file,
    output_sha256: result.output_sha256,
  };
}

function usage() {
  return `Usage:\n  mypet-engineering contract validate --contract <path> [--output <path>]\n  mypet-engineering scope --contract <path> [--head HEAD] [--output <path>]\n  mypet-engineering dependency --base <sha> [--head HEAD] [--output <path>]\n  mypet-engineering archaeology --path <path> [--max-commits 100] [--output <path>]\n  mypet-engineering certify --contract <path> [--head HEAD] [--run] [--output <path>]\n`;
}

async function main() {
  const root = repositoryRoot();
  const { options, positional } = parseArguments(process.argv.slice(2));
  const command = positional.join(' ');

  if (command === 'contract validate') {
    assertOptions(options, new Set(['contract', 'output']));
    if (!options.contract) throw new Error('--contract is required.');
    const report = contractReport(loadContract(root, options.contract));
    emit(root, report, options.output);
    return report.valid ? 0 : 2;
  }

  if (command === 'scope') {
    assertOptions(options, new Set(['contract', 'head', 'output']));
    if (!options.contract) throw new Error('--contract is required.');
    const contract = loadContract(root, options.contract);
    const validation = contractReport(contract);
    if (!validation.valid) {
      emit(root, validation, options.output);
      return 2;
    }
    const dirtyPaths = workingTreePaths(root);
    if (dirtyPaths.length > 0) {
      emit(root, {
        schema_version: 1,
        report_type: 'scope',
        status: 'BLOCKED',
        summary: `Scope analysis requires a clean working tree; found ${dirtyPaths.length} dirty path(s).`,
        next_actions: ['Commit, stash, or remove every dirty path, then rerun scope analysis.'],
        artifacts: [],
        dirty_paths: dirtyPaths,
      }, options.output);
      return 2;
    }
    const baseSha = resolveRevision(root, contract.sprint.starting_sha);
    const headSha = resolveRevision(root, options.head ?? 'HEAD');
    assertAncestor(root, baseSha, headSha);
    const changes = collectGitChanges({ repoRoot: root, base: baseSha, head: headSha });
    const report = { schema_version: 1, report_type: 'scope', base_sha: baseSha, head_sha: headSha, ...evaluateScope({ contract, changes }) };
    emit(root, report, options.output);
    return report.status === 'FAIL' ? 2 : 0;
  }

  if (command === 'dependency') {
    assertOptions(options, new Set(['base', 'head', 'output']));
    if (!options.base) throw new Error('--base is required.');
    const report = analyzeRepositoryDependencies({ repoRoot: root, base: options.base, head: options.head ?? 'HEAD' });
    emit(root, report, options.output);
    return report.status === 'FAIL' ? 2 : 0;
  }

  if (command === 'archaeology') {
    assertOptions(options, new Set(['path', 'max-commits', 'output']));
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
    assertOptions(options, new Set(['contract', 'head', 'run', 'output']));
    if (!options.contract) throw new Error('--contract is required.');
    const contract = loadContract(root, options.contract);
    const initialValidation = contractReport(contract);
    if (!initialValidation.valid) {
      emit(root, initialValidation, options.output);
      return 2;
    }
    const dirtyPaths = workingTreePaths(root);
    if (dirtyPaths.length > 0) {
      emit(root, {
        schema_version: 1,
        report_type: 'certification',
        status: 'BLOCKED',
        final: 'NOT_CERTIFIED',
        summary: `Certification requires a clean working tree; found ${dirtyPaths.length} dirty path(s).`,
        next_actions: ['Commit, stash, or remove every dirty path, then rerun certification.'],
        artifacts: [],
        blockers: [{ code: 'DIRTY_WORKTREE', paths: dirtyPaths }],
        dirty_paths: dirtyPaths,
      }, options.output);
      return 3;
    }
    const headSha = resolveRevision(root, options.head ?? 'HEAD');
    const baseSha = resolveRevision(root, contract.sprint.starting_sha);
    assertAncestor(root, baseSha, headSha);
    const changes = collectGitChanges({ repoRoot: root, base: baseSha, head: headSha });
    const changedFiles = changes.map(({ path }) => path);
    const validation = contractReport(contract, changedFiles);
    if (!validation.valid) {
      emit(root, validation, options.output);
      return 2;
    }
    const selected = selectChecks(changedFiles);
    const workerRequired = contract.workers.flatMap(({ required_check_ids: ids }) => ids);
    const requiredIds = new Set([...contract.certification.required_checks, ...workerRequired, ...selected.map(({ id }) => id)]);
    const checks = CHECK_CATALOG.filter(({ id }) => requiredIds.has(id));
    const missingIds = [...requiredIds].filter((id) => !checks.some((check) => check.id === id));
    if (missingIds.length > 0) throw new Error(`Unknown required check IDs: ${missingIds.join(', ')}`);
    const outputDirectory = `evidence/generated/engineering/${contract.sprint.id}/${headSha}`;
    const results = options.run ? await runChecks({ repoRoot: root, checks, outputDirectory, headSha }) : [];
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
        mergePolicy: contract.certification.merge_policy,
        repoRoot: root,
      }),
    };
    emit(root, report, options.output ?? (options.run ? `${outputDirectory}/certification.json` : undefined));
    return report.final === 'CERTIFIED' ? 0 : 3;
  }

  process.stderr.write(usage());
  return 1;
}

main().then((exitCode) => {
  process.exitCode = exitCode;
}).catch((error) => {
  process.stderr.write(`${error.name}: ${error.message}\n`);
  process.exitCode = 1;
});
