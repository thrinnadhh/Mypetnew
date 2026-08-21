#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "../..");

const invariantIdPattern = /^MO-[A-Z]+-[0-9]{3}$/;
const obligationIdPattern = /^M(?:[0-9]|1[0-3])-[A-Z0-9]+-[0-9]{3}$/;
const sprintIdPattern = /^M(?:[0-9]|1[0-3])$/;
const allowedStatuses = new Set(["PLANNED", "ENFORCED"]);
const allowedSeverities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const skippedWord = ["sk", "ip"].join("");
const focusedWord = ["on", "ly"].join("");
const pendingWord = ["to", "do"].join("");
const disabledAnnotation = ["@Dis", "abled"].join("");
const ignoredAnnotation = ["@Ig", "nore"].join("");
const forbiddenTestPattern = new RegExp(
  `${disabledAnnotation}\\b|${ignoredAnnotation}\\b|(?:test|it|describe)\\s*\\.\\s*(?:${skippedWord}|${focusedWord}|${pendingWord})\\s*\\(|\\b(?:fit|fdescribe|xit|xtest|xdescribe)\\s*\\(`,
);

function fail(message) {
  throw new Error(message);
}

function readJson(root, name) {
  const target = path.join(root, "contracts/merchant-operations", name);
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    fail(`Unable to read ${path.relative(root, target)}: ${error.message}`);
  }
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(`Duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

function walkFiles(root, relativeDirectory) {
  const start = path.join(root, relativeDirectory);
  if (!fs.existsSync(start)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "build", "dist", "dist-ci", ".expo"].includes(entry.name)) visit(absolute);
      } else if (entry.isFile()) {
        result.push(absolute);
      }
    }
  };
  visit(start);
  return result;
}

function validateDependencyGraph(dependencies, completedSprints) {
  const sprintIds = Object.keys(dependencies);
  if (sprintIds.length !== 14) fail(`Expected M0-M13 dependency entries, found ${sprintIds.length}`);
  assertUnique(sprintIds, "sprint ID");
  for (const sprint of sprintIds) {
    if (!sprintIdPattern.test(sprint)) fail(`Invalid sprint ID: ${sprint}`);
    requireArray(dependencies[sprint], `dependencies.${sprint}`);
    assertUnique(dependencies[sprint], `dependency of ${sprint}`);
    for (const dependency of dependencies[sprint]) {
      if (!(dependency in dependencies)) fail(`Unknown dependency ${dependency} referenced by ${sprint}`);
      if (dependency === sprint) fail(`${sprint} cannot depend on itself`);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (sprint) => {
    if (visiting.has(sprint)) fail(`Sprint dependency cycle includes ${sprint}`);
    if (visited.has(sprint)) return;
    visiting.add(sprint);
    dependencies[sprint].forEach(visit);
    visiting.delete(sprint);
    visited.add(sprint);
  };
  sprintIds.forEach(visit);

  const completed = new Set(completedSprints);
  assertUnique(completedSprints, "completed sprint");
  for (const sprint of completed) {
    if (!(sprint in dependencies)) fail(`Unknown completed sprint: ${sprint}`);
    for (const dependency of dependencies[sprint]) {
      if (!completed.has(dependency)) fail(`Completed sprint ${sprint} is missing completed dependency ${dependency}`);
    }
  }
}

function validateEvidencePath(root, relativePath, obligationId) {
  requireString(relativePath, `${obligationId}.evidence`);
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    fail(`${obligationId} has unsafe evidence path: ${relativePath}`);
  }
  const absolute = path.join(root, relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    fail(`${obligationId} evidence does not exist: ${relativePath}`);
  }
  const realRoot = `${fs.realpathSync(root)}${path.sep}`;
  const realEvidence = fs.realpathSync(absolute);
  if (!realEvidence.startsWith(realRoot)) fail(`${obligationId} evidence escapes the repository root: ${relativePath}`);
  if (!/(?:Test\.kt|\.(?:test|spec)\.[cm]?[jt]sx?|\.test\.mjs|\.sh|\.ya?ml)$/.test(relativePath)) {
    fail(`${obligationId} evidence is not an executable test or gate: ${relativePath}`);
  }
  const source = fs.readFileSync(absolute, "utf8");
  if (forbiddenTestPattern.test(source)) fail(`${obligationId} evidence contains a skipped or focused test: ${relativePath}`);
}

function validateTestIntegrity(root) {
  const governedRoots = [
    "backend/src/test",
    "apps/merchant-app",
    "apps/customer-app",
    "scripts/merchant-operations",
  ];
  const testFilePattern = /(?:Test\.kt|Tests?\.kt|\.test\.[cm]?[jt]sx?|\.spec\.[cm]?[jt]sx?|\.test\.mjs)$/;
  for (const governedRoot of governedRoots) {
    for (const absolute of walkFiles(root, governedRoot)) {
      if (!testFilePattern.test(absolute)) continue;
      const source = fs.readFileSync(absolute, "utf8");
      if (forbiddenTestPattern.test(source)) {
        fail(`Skipped or focused test is forbidden: ${path.relative(root, absolute)}`);
      }
    }
  }
}

function validateClientBoundaries(root) {
  const privilegedPattern = /SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|FIREBASE_PRIVATE_KEY|GOOGLE_APPLICATION_CREDENTIALS/;
  const directDomainMutationPattern = /\bsupabase\s*\.\s*(?:from|rpc)\s*\(/;
  for (const clientRoot of ["apps/customer-app/src", "apps/merchant-app/src"]) {
    for (const absolute of walkFiles(root, clientRoot)) {
      if (!/\.[cm]?[jt]sx?$/.test(absolute) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(absolute)) continue;
      const source = fs.readFileSync(absolute, "utf8");
      const relative = path.relative(root, absolute);
      if (privilegedPattern.test(source)) fail(`Privileged server configuration referenced by client source: ${relative}`);
      if (directDomainMutationPattern.test(source)) fail(`Direct Supabase domain-table access is forbidden in role clients: ${relative}`);
    }
  }
}

function validateRequiredSurface(root) {
  const requiredFiles = [
    ".github/workflows/merchant-operations-contract.yml",
    ".github/pull_request_template.md",
    "scripts/merchant-operations/verify-forward-migrations.sh",
    "scripts/verify-merchant-operations.sh",
    "contracts/merchant-operations/sealed-flyway-v21.sha256",
  ];
  for (const relative of requiredFiles) {
    if (!fs.existsSync(path.join(root, relative))) fail(`Required M0 file is missing: ${relative}`);
  }

  const merchantPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/merchant-app/package.json"), "utf8"));
  for (const script of ["test:ci", "test:contract", "test:offline"]) {
    if (!merchantPackage.scripts?.[script]) fail(`Merchant package is missing npm script ${script}`);
  }
  const customerPackage = JSON.parse(fs.readFileSync(path.join(root, "apps/customer-app/package.json"), "utf8"));
  if (!customerPackage.scripts?.["test:merchant-consistency"]) {
    fail("Customer package is missing npm script test:merchant-consistency");
  }
}

export function validateProgram(root = defaultRoot) {
  const invariantsDocument = readJson(root, "invariants.json");
  const dependenciesDocument = readJson(root, "sprint-dependencies.json");
  const obligationsDocument = readJson(root, "test-obligations.json");
  const stateDocument = readJson(root, "program-state.json");
  for (const [name, document] of Object.entries({ invariantsDocument, dependenciesDocument, obligationsDocument, stateDocument })) {
    if (document.schemaVersion !== 1) fail(`${name} has unsupported schemaVersion ${document.schemaVersion}`);
  }

  const invariants = requireArray(invariantsDocument.invariants, "invariants");
  const invariantIds = invariants.map((invariant, index) => {
    const id = requireString(invariant.id, `invariants[${index}].id`);
    if (!invariantIdPattern.test(id)) fail(`Invalid invariant ID: ${id}`);
    requireString(invariant.owner, `${id}.owner`);
    requireString(invariant.description, `${id}.description`);
    if (!allowedSeverities.has(invariant.severity)) fail(`${id} has invalid severity ${invariant.severity}`);
    return id;
  });
  assertUnique(invariantIds, "invariant ID");
  const invariantSet = new Set(invariantIds);

  const completedSprints = requireArray(stateDocument.completedSprints, "completedSprints");
  if (!/^[0-9a-f]{40}$/.test(stateDocument.baselineMainSha ?? "")) fail("baselineMainSha must be a full Git SHA");
  validateDependencyGraph(dependenciesDocument.dependencies ?? {}, completedSprints);
  const completed = new Set(completedSprints);

  const obligations = requireArray(obligationsDocument.obligations, "obligations");
  const obligationIds = obligations.map((obligation, index) => {
    const id = requireString(obligation.id, `obligations[${index}].id`);
    if (!obligationIdPattern.test(id)) fail(`Invalid obligation ID: ${id}`);
    if (!(obligation.sprint in dependenciesDocument.dependencies)) fail(`${id} references unknown sprint ${obligation.sprint}`);
    requireString(obligation.category, `${id}.category`);
    requireString(obligation.description, `${id}.description`);
    if (!allowedSeverities.has(obligation.severity)) fail(`${id} has invalid severity ${obligation.severity}`);
    if (!allowedStatuses.has(obligation.status)) fail(`${id} has invalid status ${obligation.status}`);
    const references = requireArray(obligation.invariantIds, `${id}.invariantIds`);
    if (references.length === 0) fail(`${id} must reference at least one invariant`);
    for (const invariantId of references) if (!invariantSet.has(invariantId)) fail(`${id} references unknown invariant ${invariantId}`);
    const evidence = requireArray(obligation.evidence, `${id}.evidence`);
    if (completed.has(obligation.sprint) && obligation.status !== "ENFORCED") {
      fail(`Completed sprint ${obligation.sprint} still has planned obligation ${id}`);
    }
    if (obligation.status === "ENFORCED") {
      if (evidence.length === 0) fail(`Enforced obligation ${id} has no evidence`);
      evidence.forEach((relative) => validateEvidencePath(root, relative, id));
    } else if (evidence.length > 0) {
      fail(`Planned obligation ${id} must not claim evidence`);
    }
    return id;
  });
  assertUnique(obligationIds, "obligation ID");

  for (const sprint of Object.keys(dependenciesDocument.dependencies)) {
    if (!obligations.some((obligation) => obligation.sprint === sprint)) fail(`Sprint ${sprint} has no test obligation`);
  }

  validateTestIntegrity(root);
  validateClientBoundaries(root);
  validateRequiredSurface(root);

  return {
    completedSprints: [...completed].sort(),
    invariantCount: invariantIds.length,
    obligationCount: obligationIds.length,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = validateProgram(process.argv[2] ? path.resolve(process.argv[2]) : defaultRoot);
    console.log(`Merchant Operations program contract passed: ${result.invariantCount} invariants, ${result.obligationCount} obligations, completed ${result.completedSprints.join(", ")}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
