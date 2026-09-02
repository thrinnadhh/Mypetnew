const TOP_LEVEL_KEYS = new Set(['schema_version', 'sprint', 'scope', 'workers', 'acceptance', 'certification']);
const SPRINT_KEYS = new Set(['id', 'objective', 'starting_sha']);
const SCOPE_KEYS = new Set(['allowed_paths', 'forbidden_paths', 'justifications']);
const WORKER_KEYS = new Set([
  'id',
  'role',
  'objective',
  'allowed_paths',
  'forbidden_paths',
  'repository_facts',
  'dependencies',
  'acceptance_criteria',
  'required_check_ids',
  'expected_artifacts',
  'evidence_requirements',
]);
const ACCEPTANCE_KEYS = new Set(['functional', 'regression', 'security', 'contracts']);
const CERTIFICATION_KEYS = new Set(['required_checks', 'merge_policy']);
const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SAFE_PATH_CHARS = /^[A-Za-z0-9_./*{}-]+$/;
const SHA_40 = /^[0-9a-f]{40}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectUnknownKeys(value, allowed, location, errors) {
  if (!isObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${location}.${key} is not supported`);
  }
}

function requireObject(value, location, errors) {
  if (!isObject(value)) {
    errors.push(`${location} must be an object`);
    return false;
  }
  return true;
}

function requireString(value, location, errors, { pattern, allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.trim().length === 0)) {
    errors.push(`${location} must be a non-empty string`);
    return false;
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${location} has an invalid format`);
    return false;
  }
  return true;
}

function requireStringArray(value, location, errors, { allowEmpty = false, itemValidator } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${location} must be ${allowEmpty ? 'an' : 'a non-empty'} array`);
    return false;
  }
  const seen = new Set();
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      errors.push(`${location}[${index}] must be a non-empty string`);
    } else if (itemValidator && !itemValidator(item)) {
      errors.push(`${location}[${index}] has an invalid format`);
    }
    if (typeof item === 'string' && seen.has(item)) errors.push(`${location}[${index}] must be unique`);
    if (typeof item === 'string') seen.add(item);
  });
  return true;
}

export function isSafeRepositoryPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > 240) return false;
  if (!SAFE_PATH_CHARS.test(pattern) || pattern.startsWith('/') || pattern.includes('\\')) return false;
  const segments = pattern.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return !/[;&|`$><()\[\]\n\r]/.test(pattern);
}

export function isSafeRepositoryPath(path) {
  return isSafeRepositoryPattern(path) && !path.includes('*') && !path.includes('{') && !path.includes('}');
}

function escapeRegex(character) {
  return /[\\^$+?.()|[\]{}]/.test(character) ? `\\${character}` : character;
}

export function patternToRegExp(pattern) {
  if (!isSafeRepositoryPattern(pattern)) throw new Error(`Unsafe repository pattern: ${pattern}`);
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      if (pattern[index + 1] === '*') {
        const followedBySlash = pattern[index + 2] === '/';
        expression += followedBySlash ? '(?:.*/)?' : '.*';
        index += followedBySlash ? 2 : 1;
      } else {
        expression += '[^/]*';
      }
    } else {
      expression += escapeRegex(character);
    }
  }
  return new RegExp(`${expression}$`);
}

export function matchesPattern(path, pattern) {
  if (!isSafeRepositoryPath(path)) return false;
  return patternToRegExp(pattern).test(path);
}

function patternCovers(containerPattern, candidatePattern) {
  if (containerPattern === '**' || containerPattern === candidatePattern) return true;
  if (!containerPattern.endsWith('/**') || containerPattern.slice(0, -3).includes('*')) return false;
  const containerDirectory = containerPattern.slice(0, -3);
  if (!candidatePattern.startsWith(`${containerDirectory}/`)) return false;
  const candidateLiteralPrefix = candidatePattern.split('*', 1)[0].replace(/\/$/, '');
  return candidateLiteralPrefix === containerDirectory || candidateLiteralPrefix.startsWith(`${containerDirectory}/`);
}

function workerPatternWithinSprint(workerPattern, sprintPatterns) {
  return sprintPatterns.some((sprintPattern) => patternCovers(sprintPattern, workerPattern));
}

function validatePathPatterns(value, location, errors, options = {}) {
  if (!requireStringArray(value, location, errors, { ...options, itemValidator: isSafeRepositoryPattern })) return;
  value.forEach((pattern, index) => {
    if (!isSafeRepositoryPattern(pattern)) {
      errors.push(`${location}[${index}] must be a safe repository-relative pattern`);
    }
  });
}

function observation(valid, errors, warnings = []) {
  return {
    status: valid ? 'success' : 'error',
    summary: valid ? 'Sprint contract is valid.' : `Sprint contract has ${errors.length} error(s).`,
    next_actions: valid ? [] : ['Repair the reported contract fields and validate again.'],
    artifacts: [],
    valid,
    errors,
    warnings,
  };
}

export function validateSprintContract(contract, { changedPaths = [], knownCheckIds } = {}) {
  const errors = [];
  const warnings = [];
  const knownChecks = knownCheckIds ? new Set(knownCheckIds) : null;

  if (!requireObject(contract, 'contract', errors)) return observation(false, errors);
  rejectUnknownKeys(contract, TOP_LEVEL_KEYS, 'contract', errors);

  if (contract.schema_version !== 1) errors.push('schema_version must equal 1');

  if (requireObject(contract.sprint, 'sprint', errors)) {
    rejectUnknownKeys(contract.sprint, SPRINT_KEYS, 'sprint', errors);
    requireString(contract.sprint.id, 'sprint.id', errors, { pattern: SAFE_ID });
    requireString(contract.sprint.objective, 'sprint.objective', errors);
    requireString(contract.sprint.starting_sha, 'sprint.starting_sha', errors, { pattern: SHA_40 });
  }

  if (requireObject(contract.scope, 'scope', errors)) {
    rejectUnknownKeys(contract.scope, SCOPE_KEYS, 'scope', errors);
    validatePathPatterns(contract.scope.allowed_paths, 'scope.allowed_paths', errors);
    validatePathPatterns(contract.scope.forbidden_paths, 'scope.forbidden_paths', errors, { allowEmpty: true });
    if (!isObject(contract.scope.justifications)) {
      errors.push('scope.justifications must be an object');
    } else {
      for (const [pattern, justification] of Object.entries(contract.scope.justifications)) {
        if (!isSafeRepositoryPattern(pattern) || typeof justification !== 'string' || justification.trim().length === 0) {
          errors.push(`scope.justifications.${pattern} must map a safe path pattern to a non-empty reason`);
        }
      }
    }
  }

  if (!Array.isArray(contract.workers) || contract.workers.length === 0) {
    errors.push('workers must be a non-empty array');
  } else {
    const ids = new Set();
    contract.workers.forEach((worker, index) => {
      const location = `workers[${index}]`;
      if (!requireObject(worker, location, errors)) return;
      rejectUnknownKeys(worker, WORKER_KEYS, location, errors);
      requireString(worker.id, `${location}.id`, errors, { pattern: SAFE_ID });
      requireString(worker.role, `${location}.role`, errors);
      requireString(worker.objective, `${location}.objective`, errors);
      validatePathPatterns(worker.allowed_paths, `${location}.allowed_paths`, errors);
      validatePathPatterns(worker.forbidden_paths, `${location}.forbidden_paths`, errors, { allowEmpty: true });
      requireStringArray(worker.repository_facts, `${location}.repository_facts`, errors);
      requireStringArray(worker.dependencies, `${location}.dependencies`, errors, { allowEmpty: true, itemValidator: (item) => SAFE_ID.test(item) });
      requireStringArray(worker.acceptance_criteria, `${location}.acceptance_criteria`, errors);
      requireStringArray(worker.required_check_ids, `${location}.required_check_ids`, errors, { itemValidator: (item) => SAFE_ID.test(item) });
      if (knownChecks && Array.isArray(worker.required_check_ids)) {
        for (const checkId of worker.required_check_ids) {
          if (!knownChecks.has(checkId)) errors.push(`${location}.required_check_ids references unknown check id ${checkId}`);
        }
      }
      requireStringArray(worker.expected_artifacts, `${location}.expected_artifacts`, errors, { itemValidator: isSafeRepositoryPattern });
      requireStringArray(worker.evidence_requirements, `${location}.evidence_requirements`, errors);
      if (ids.has(worker.id)) errors.push(`${location}.id must be unique`);
      ids.add(worker.id);
      if (Array.isArray(worker.allowed_paths) && Array.isArray(contract.scope?.allowed_paths)) {
        for (const pattern of worker.allowed_paths) {
          if (isSafeRepositoryPattern(pattern) && !workerPatternWithinSprint(pattern, contract.scope.allowed_paths)) {
            errors.push(`${location}.allowed_paths contains ${pattern}, which is outside sprint scope`);
          }
        }
      }
      if (Array.isArray(worker.forbidden_paths) && Array.isArray(contract.scope?.forbidden_paths)) {
        for (const sprintForbidden of contract.scope.forbidden_paths) {
          if (!worker.forbidden_paths.some((workerForbidden) => patternCovers(workerForbidden, sprintForbidden))) {
            errors.push(`${location}.forbidden_paths must inherit sprint forbidden path ${sprintForbidden}`);
          }
        }
      }
    });
    contract.workers.forEach((worker, index) => {
      if (!Array.isArray(worker?.dependencies)) return;
      for (const dependency of worker.dependencies) {
        if (!ids.has(dependency)) errors.push(`workers[${index}].dependencies references unknown worker ${dependency}`);
        if (dependency === worker.id) errors.push(`workers[${index}].dependencies cannot reference itself`);
      }
    });
    const dependenciesById = new Map(contract.workers.filter(isObject).map((worker) => [worker.id, Array.isArray(worker.dependencies) ? worker.dependencies : []]));
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
      if (visiting.has(id)) return true;
      if (visited.has(id) || !dependenciesById.has(id)) return false;
      visiting.add(id);
      for (const dependency of dependenciesById.get(id)) if (hasCycle(dependency)) return true;
      visiting.delete(id);
      visited.add(id);
      return false;
    };
    if ([...dependenciesById.keys()].some((id) => hasCycle(id))) errors.push('workers dependency graph contains a cycle');
  }

  if (requireObject(contract.acceptance, 'acceptance', errors)) {
    rejectUnknownKeys(contract.acceptance, ACCEPTANCE_KEYS, 'acceptance', errors);
    for (const key of ACCEPTANCE_KEYS) requireStringArray(contract.acceptance[key], `acceptance.${key}`, errors);
  }

  if (requireObject(contract.certification, 'certification', errors)) {
    rejectUnknownKeys(contract.certification, CERTIFICATION_KEYS, 'certification', errors);
    requireStringArray(contract.certification.required_checks, 'certification.required_checks', errors, {
      itemValidator: (item) => SAFE_ID.test(item),
    });
    if (knownChecks && Array.isArray(contract.certification.required_checks)) {
      for (const checkId of contract.certification.required_checks) {
        if (!knownChecks.has(checkId)) errors.push(`certification.required_checks references unknown check id ${checkId}`);
      }
    }
    if (!['all_required_pass', 'all_required_pass_no_warnings'].includes(contract.certification.merge_policy)) {
      errors.push('certification.merge_policy must be all_required_pass or all_required_pass_no_warnings');
    }
    if (Array.isArray(contract.certification.required_checks) && Array.isArray(contract.workers)) {
      const certificationChecks = new Set(contract.certification.required_checks);
      for (const worker of contract.workers.filter(isObject)) {
        for (const checkId of Array.isArray(worker.required_check_ids) ? worker.required_check_ids : []) {
          if (!certificationChecks.has(checkId)) errors.push(`certification.required_checks must include worker-required check ${checkId}`);
        }
      }
    }
  }

  for (const path of changedPaths) {
    if (!isSafeRepositoryPath(path)) {
      errors.push(`changed path is not repository-relative: ${path}`);
      continue;
    }
    if ((contract.scope?.forbidden_paths ?? []).some((pattern) => isSafeRepositoryPattern(pattern) && matchesPattern(path, pattern))) {
      errors.push(`changed path violates a forbidden path: ${path}`);
    }
  }

  return observation(errors.length === 0, errors, warnings);
}
