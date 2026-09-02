import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { posix, resolve, win32 } from 'node:path';

const COMMIT_ID = /^[0-9a-f]{40,64}$/;
const BUG_FIX_SUBJECT = /\b(?:bug(?:fix)?|fix(?:e[ds])?|hotfix|patch(?:e[ds])?|regression|repair(?:e[ds])?)\b/i;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertRepositoryRelativePath(path) {
  if (
    typeof path !== 'string'
    || path.length === 0
    || path.length > 1024
    || path.includes('\0')
    || path.includes('\\')
    || posix.isAbsolute(path)
    || win32.isAbsolute(path)
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`File path must be a repository-relative path: ${String(path)}`);
  }
  return path;
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', ['--no-pager', '--literal-pathspecs', ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
      windowsHide: true,
    });
  } catch (error) {
    if (allowFailure) return null;
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const detail = stderr.length > 0 ? `: ${stderr.split('\n')[0]}` : '';
    throw new Error(`Git history inspection failed${detail}`, { cause: error });
  }
}

function repositoryTopLevel(repoRoot) {
  if (typeof repoRoot !== 'string' || repoRoot.trim().length === 0) {
    throw new TypeError('repoRoot must be a non-empty path.');
  }
  let existingRoot;
  try {
    existingRoot = realpathSync(resolve(repoRoot));
  } catch (error) {
    throw new Error('repoRoot must identify an existing Git repository.', { cause: error });
  }
  const output = git(existingRoot, ['rev-parse', '--show-toplevel']);
  try {
    return realpathSync(output.trim());
  } catch (error) {
    throw new Error('Git returned an invalid repository root.', { cause: error });
  }
}

function parseCommitLog(output) {
  if (!output) return [];
  const tokens = output.split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const commits = [];
  for (let index = 0; index + 3 < tokens.length; index += 4) {
    const [commit, authoredAt, author, subject] = tokens.slice(index, index + 4);
    if (!COMMIT_ID.test(commit)) continue;
    commits.push({
      commit,
      authored_at: authoredAt,
      author,
      subject,
    });
  }
  return commits;
}

function rawCommitLog(repoRoot, path, extraArguments = []) {
  const output = git(repoRoot, [
    'log',
    '-z',
    '--follow',
    ...extraArguments,
    '--format=%H%x00%aI%x00%an%x00%s',
    '--',
    path,
  ]);
  return parseCommitLog(output);
}

function commitLog(repoRoot, path, maxCommits) {
  const commits = rawCommitLog(repoRoot, path, [`--max-count=${maxCommits + 1}`]);
  return {
    commits: commits.slice(0, maxCommits),
    truncated: commits.length > maxCommits,
  };
}

function introductionCommit(repoRoot, path, fallback) {
  const additions = rawCommitLog(repoRoot, path, ['--diff-filter=A']);
  return additions.at(-1) ?? fallback;
}

function commitChangedPaths(repoRoot, commit) {
  if (!COMMIT_ID.test(commit)) throw new Error('Git returned an invalid commit identifier.');
  const output = git(repoRoot, [
    'diff-tree',
    '--root',
    '-m',
    '--no-commit-id',
    '--name-only',
    '--no-renames',
    '-r',
    '-z',
    commit,
    '--',
  ]);
  return [...new Set(output.split('\0').filter(Boolean))].sort(compareText);
}

function coChangedFiles(repoRoot, path, commits) {
  const byPath = new Map();
  for (const { commit } of commits) {
    for (const changedPath of commitChangedPaths(repoRoot, commit)) {
      if (changedPath === path) continue;
      if (!byPath.has(changedPath)) byPath.set(changedPath, []);
      byPath.get(changedPath).push(commit);
    }
  }
  return [...byPath.entries()]
    .map(([changedPath, commitIds]) => ({
      path: changedPath,
      count: commitIds.length,
      commits: commitIds,
    }))
    .sort((left, right) => right.count - left.count || compareText(left.path, right.path));
}

function parseBlame(output) {
  const origins = [];
  let current = null;
  for (const line of output.split('\n')) {
    const header = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (header) {
      current = {
        commit: header[1],
        original_line: Number(header[2]),
        line: Number(header[3]),
        author: null,
        authored_at: null,
        summary: null,
        source_path: null,
        content: null,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('author ')) current.author = line.slice('author '.length);
    else if (line.startsWith('author-time ')) {
      const seconds = Number(line.slice('author-time '.length));
      if (Number.isSafeInteger(seconds)) {
        const timestamp = new Date(seconds * 1000);
        current.authored_at = Number.isNaN(timestamp.valueOf()) ? null : timestamp.toISOString();
      }
    } else if (line.startsWith('summary ')) current.summary = line.slice('summary '.length);
    else if (line.startsWith('filename ')) current.source_path = line.slice('filename '.length);
    else if (line.startsWith('\t')) {
      current.content = line.slice(1);
      origins.push(current);
      current = null;
    }
  }
  return origins.sort((left, right) => left.line - right.line);
}

function lineOrigins(repoRoot, path) {
  const output = git(repoRoot, ['blame', '--line-porcelain', 'HEAD', '--', path], { allowFailure: true });
  return output === null ? [] : parseBlame(output);
}

export function analyzeFileHistory({ repoRoot, path, maxCommits = 100 } = {}) {
  const repositoryPath = assertRepositoryRelativePath(path);
  if (!Number.isInteger(maxCommits) || maxCommits < 1 || maxCommits > 1000) {
    throw new RangeError('maxCommits must be an integer between 1 and 1000.');
  }

  const root = repositoryTopLevel(repoRoot);
  const history = commitLog(root, repositoryPath, maxCommits);
  const commits = history.commits;
  const bugFixCommits = commits.filter(({ subject }) => BUG_FIX_SUBJECT.test(subject));
  const introduced = commits.length === 0 ? null : introductionCommit(root, repositoryPath, commits.at(-1));
  const coChanges = coChangedFiles(root, repositoryPath, commits);
  const origins = lineOrigins(root, repositoryPath);
  const status = commits.length > 0 ? 'success' : 'error';

  return {
    status,
    summary: commits.length > 0
      ? `${repositoryPath} has ${commits.length} commit(s), ${bugFixCommits.length} bug-fix commit(s), and ${coChanges.length} co-changed file(s) in the inspected history.`
      : `No Git history was found for ${repositoryPath}.`,
    next_actions: commits.length > 0 ? [] : ['Confirm the file is tracked at HEAD and that the repository history is available.'],
    artifacts: [],
    repository_root: root,
    path: repositoryPath,
    max_commits: maxCommits,
    truncated: history.truncated,
    introduced,
    commits,
    bug_fix_commits: bugFixCommits,
    co_changed_files: coChanges,
    line_origins: origins,
    repeated_regressions: bugFixCommits.length > 1,
    regression_signal_count: bugFixCommits.length,
  };
}
