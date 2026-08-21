import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateProgram } from "./validate-program.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");

function write(root, relative, content = "") {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function writeJson(root, relative, value) {
  write(root, relative, `${JSON.stringify(value, null, 2)}\n`);
}

function dependencies() {
  const result = { M0: [] };
  for (let index = 1; index <= 13; index += 1) result[`M${index}`] = [`M${index - 1}`];
  return result;
}

function validFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mypetnew-program-"));
  const sourceContracts = path.join(repositoryRoot, "contracts/merchant-operations");
  for (const name of ["invariants.json", "test-obligations.json"]) {
    write(root, `contracts/merchant-operations/${name}`, fs.readFileSync(path.join(sourceContracts, name), "utf8"));
  }
  writeJson(root, "contracts/merchant-operations/sprint-dependencies.json", { schemaVersion: 1, dependencies: dependencies() });
  writeJson(root, "contracts/merchant-operations/program-state.json", {
    schemaVersion: 1,
    baselineMainSha: "a".repeat(40),
    completedSprints: ["M0"],
  });
  const obligationsPath = path.join(root, "contracts/merchant-operations/test-obligations.json");
  const obligationsDocument = JSON.parse(fs.readFileSync(obligationsPath, "utf8"));
  for (const obligation of obligationsDocument.obligations) {
    if (obligation.status !== "ENFORCED") continue;
    obligation.evidence = [`evidence/${obligation.id}.test.ts`];
    write(root, obligation.evidence[0], "test('gate', () => expect(true).toBe(true));\n");
  }
  fs.writeFileSync(obligationsPath, `${JSON.stringify(obligationsDocument, null, 2)}\n`);
  write(root, ".github/workflows/merchant-operations-contract.yml", "name: fixture\n");
  write(root, ".github/pull_request_template.md", "# fixture\n");
  write(root, "scripts/merchant-operations/verify-forward-migrations.sh", "#!/usr/bin/env bash\n");
  write(root, "scripts/verify-merchant-operations.sh", "#!/usr/bin/env bash\n");
  write(root, "contracts/merchant-operations/sealed-flyway-v21.sha256", "fixture\n");
  writeJson(root, "apps/merchant-app/package.json", {
    scripts: { "test:ci": "jest", "test:contract": "jest", "test:offline": "jest" },
  });
  writeJson(root, "apps/customer-app/package.json", { scripts: { "test:merchant-consistency": "jest" } });
  return root;
}

function mutateJson(root, relative, mutation) {
  const target = path.join(root, relative);
  const document = JSON.parse(fs.readFileSync(target, "utf8"));
  mutation(document);
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
}

function expectFailure(root, pattern) {
  assert.throws(() => validateProgram(root), pattern);
}

test("valid program manifest and evidence pass", () => {
  const root = validFixture();
  assert.deepEqual(validateProgram(root), { completedSprints: ["M0"], invariantCount: 22, obligationCount: 27 });
});

test("duplicate invariant IDs fail closed", () => {
  const root = validFixture();
  mutateJson(root, "contracts/merchant-operations/invariants.json", (document) => document.invariants.push({ ...document.invariants[0] }));
  expectFailure(root, /Duplicate invariant ID/);
});

test("required invariants and obligations cannot be silently removed", () => {
  const root = validFixture();
  mutateJson(root, "contracts/merchant-operations/invariants.json", (document) => {
    document.invariants = document.invariants.filter((invariant) => invariant.id !== "MO-INV-001");
  });
  expectFailure(root, /Required invariant is missing: MO-INV-001/);

  const secondRoot = validFixture();
  mutateJson(secondRoot, "contracts/merchant-operations/test-obligations.json", (document) => {
    document.obligations = document.obligations.filter((obligation) => obligation.id !== "M9-RACE-001");
  });
  expectFailure(secondRoot, /Required test obligation is missing: M9-RACE-001/);
});

test("unknown dependencies and incomplete dependency closure fail closed", () => {
  const root = validFixture();
  mutateJson(root, "contracts/merchant-operations/sprint-dependencies.json", (document) => document.dependencies.M1 = ["M99"]);
  expectFailure(root, /Unknown dependency M99/);

  const secondRoot = validFixture();
  mutateJson(secondRoot, "contracts/merchant-operations/program-state.json", (document) => document.completedSprints = ["M1"]);
  expectFailure(secondRoot, /missing completed dependency M0/);
});

test("completed sprint with planned obligation fails closed", () => {
  const root = validFixture();
  mutateJson(root, "contracts/merchant-operations/program-state.json", (document) => document.completedSprints.push("M1"));
  expectFailure(root, /still has planned obligation M1-AUTH-001/);
});

test("missing evidence and disabled or focused evidence fail closed", () => {
  const root = validFixture();
  fs.rmSync(path.join(root, "evidence/M0-GATE-001.test.ts"));
  expectFailure(root, /evidence does not exist/);

  const focusedRoot = validFixture();
  const focusedCall = ["test", "only"].join(".");
  write(focusedRoot, "evidence/M0-GATE-001.test.ts", `${focusedCall}('bad', () => {});\n`);
  expectFailure(focusedRoot, /skipped or focused test/i);
});

test("direct role-client Supabase table access and privileged keys fail closed", () => {
  const root = validFixture();
  write(root, "apps/merchant-app/src/bad.ts", "export const value = supabase.from('inventory_balance');\n");
  expectFailure(root, /Direct Supabase domain-table access/);

  const secondRoot = validFixture();
  write(secondRoot, "apps/customer-app/src/bad.ts", `export const key = '${["DATABASE", "PASSWORD"].join("_")}';\n`);
  expectFailure(secondRoot, /Privileged server configuration/);
});

function run(command, args, cwd) {
  return spawnSync(command, args, { cwd, encoding: "utf8" });
}

test("forward migration gate accepts a new migration and rejects historical drift and duplicate versions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mypetnew-migrations-"));
  const migration = "backend/src/main/resources/db/migration/V1__initial.sql";
  const initial = "CREATE TABLE example(id INTEGER PRIMARY KEY);\n";
  write(root, migration, initial);
  const digest = crypto.createHash("sha256").update(initial).digest("hex");
  write(root, "contracts/merchant-operations/sealed-flyway-v21.sha256", `${digest}  V1__initial.sql\n`);
  assert.equal(run("git", ["init", "-q"], root).status, 0);
  assert.equal(run("git", ["config", "user.email", "m0@example.invalid"], root).status, 0);
  assert.equal(run("git", ["config", "user.name", "M0 Test"], root).status, 0);
  assert.equal(run("git", ["add", "--", "."], root).status, 0);
  assert.equal(run("git", ["commit", "-qm", "baseline"], root).status, 0);
  const base = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  write(root, "backend/src/main/resources/db/migration/V2__forward.sql", "ALTER TABLE example ADD COLUMN name TEXT;\n");
  let result = run("bash", [path.join(repositoryRoot, "scripts/merchant-operations/verify-forward-migrations.sh"), "--root", root, "--base", base], root);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  write(root, migration, `${initial}-- changed\n`);
  result = run("bash", [path.join(repositoryRoot, "scripts/merchant-operations/verify-forward-migrations.sh"), "--root", root, "--base", base], root);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Sealed migration changed|Historical Flyway migrations are immutable/);

  write(root, migration, initial);
  write(root, "backend/src/main/resources/db/migration/V2__duplicate.sql", "SELECT 1;\n");
  result = run("bash", [path.join(repositoryRoot, "scripts/merchant-operations/verify-forward-migrations.sh"), "--root", root, "--base", base], root);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /Duplicate Flyway migration version V2/);
});
