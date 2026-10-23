import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * A rename refactor that has to edit its lint configuration, its build script and its tests, as
 * the October 23 fastify and markdown-it tasks did, measured by the real verification with the
 * real Biome this repository installs. The correct change must pass with its configuration
 * transported; each control hides damage behind a configuration edit and must stay refused.
 */
let scratch = "";
let root = "";
const clock = { now: () => 0, sleep: () => Promise.resolve() };

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-rename-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

function git(args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

const manifest = (test: string) =>
  `${JSON.stringify(
    {
      name: "w",
      private: true,
      scripts: { build: "node scripts/build.mjs", lint: "biome lint lib", test },
      devDependencies: { "@biomejs/biome": "2.5.8" },
    },
    null,
    2,
  )}\n`;

const lintConfiguration = (ignored: readonly string[]) =>
  `${JSON.stringify({
    files: { includes: ["lib/**", ...ignored.map((path) => `!${path}`)] },
    linter: { enabled: true, rules: { preset: "recommended" } },
  })}\n`;

const build = (entry: string, write = true) =>
  [
    'import { mkdirSync, readFileSync, writeFileSync } from "node:fs";',
    `const entry = "${entry}";`,
    'mkdirSync("dist", { recursive: true });',
    write
      ? 'writeFileSync("dist/bundle.js", readFileSync(entry, "utf8"));'
      : "readFileSync(entry);",
    "",
  ].join("\n");

const library = (table: string, body = "values.reduce((a, b) => a + b, 0)") =>
  `const { table } = require("./${table}");\nexports.sum = (values) => ${body};\nexports.tableSum = () => exports.sum(table);\n`;

const tests = (module: string) =>
  [
    'const test = require("node:test");',
    'const assert = require("node:assert");',
    `const { sum, tableSum } = require("../lib/${module}");`,
    'test("sum", () => assert.equal(sum([1, 2]), 3));',
    'test("table sum", () => assert.equal(tableSum(), 6));',
    "",
  ].join("\n");

/** A generated file with a lint finding the configuration ignores, as fastify's validator is. */
const generated = "// generated\nmodule.exports = { table: [1, 2, 3] };\ndebugger;\n";

async function base(): Promise<string> {
  root = await mkdtemp(join(scratch, "repo-"));
  git(["init", "-q"]);
  await put("package.json", manifest("node --test"));
  await put("biome.json", lintConfiguration(["lib/generatedTable.js"]));
  await put("lib/generatedTable.js", generated);
  await put("lib/mathUtils.js", library("generatedTable.js"));
  await put("scripts/build.mjs", build("lib/mathUtils.js"));
  await put("test/math.test.js", tests("mathUtils.js"));
  await put(".gitignore", "node_modules\ndist\n");
  await symlink(resolve("node_modules"), join(root, "node_modules"));
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  return git(["rev-parse", "HEAD"]);
}

/** The task done right: two files renamed and every reference to them moved. */
async function rename(): Promise<void> {
  git(["mv", "lib/mathUtils.js", "lib/math-utils.js"]);
  git(["mv", "lib/generatedTable.js", "lib/generated-table.js"]);
  await put("lib/math-utils.js", library("generated-table.js"));
  await put("biome.json", lintConfiguration(["lib/generated-table.js"]));
  await put("scripts/build.mjs", build("lib/math-utils.js"));
  await put("test/math.test.js", tests("math-utils.js"));
}

async function verify(commit: string) {
  git(["add", "-A"]);
  const patch = git(["diff", "--cached", "-M", commit]);
  git(["reset", "-q", "--hard", commit]);
  const result = await verifyIndependently({
    repositoryRoot: root,
    baseCommit: commit,
    patch: `${patch}\n`,
    commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
    clock,
  });
  const status = (id: string) => result.checks.find((one) => one.id === id)?.status;
  return { result, status };
}

describe("a rename that moves its configuration's references", () => {
  it("passes with its lint configuration, build script and tests transported", async () => {
    const commit = await base();
    await rename();
    const { result, status } = await verify(commit);
    expect([status("build"), status("lint"), status("tests")]).toEqual([
      "passed",
      "passed",
      "passed",
    ]);
    const lint = result.checks.find((one) => one.id === "lint");
    expect(lint?.configurationStatus).toBeUndefined();
    expect(lint?.instrument?.transport?.renames.map(({ from, to }) => [from, to])).toEqual([
      ["lib/generatedTable.js", "lib/generated-table.js"],
      ["lib/mathUtils.js", "lib/math-utils.js"],
    ]);
    expect(result.checks.find((one) => one.id === "tests")?.baseTestsTransported).toEqual([
      "test/math.test.js",
    ]);
    expect(result.regression).toBe("pass");
    // The dependency-free verifier re-derives the same verdict from the recorded readings.
    expect(capturedRegression(JSON.parse(JSON.stringify(result.checks)))).toBe("pass");
  }, 240_000);

  it.each([
    [
      "tests silently omitted while the code is broken",
      async () => {
        await put("package.json", manifest("node --test --test-name-pattern=nothing-matches"));
        await put("lib/math-utils.js", library("generated-table.js", "0"));
      },
      "tests",
    ],
    [
      "a lint finding hidden by ignoring the file it is in",
      async () => {
        await put("biome.json", lintConfiguration(["lib/generated-table.js", "lib/math-utils.js"]));
        await put("lib/math-utils.js", `${library("generated-table.js")}debugger;\n`);
      },
      "lint",
    ],
    [
      "a failing suite's status swallowed",
      async () => {
        await put("package.json", manifest("node --test || true"));
        await put("lib/math-utils.js", library("generated-table.js", "0"));
      },
      "tests",
    ],
    [
      "a passing report fabricated",
      async () => {
        await put("package.json", manifest("echo '# pass 2' && echo '# fail 0'"));
        await put("lib/math-utils.js", library("generated-table.js", "0"));
      },
      "tests",
    ],
    [
      "the build output no longer written",
      async () => {
        await put("scripts/build.mjs", build("lib/math-utils.js", false));
      },
      "build",
    ],
  ])(
    "refuses %s",
    async (_name, damage, refused) => {
      const commit = await base();
      await rename();
      await damage();
      const { result, status } = await verify(commit);
      expect(status(refused)).not.toBe("passed");
      expect(result.regression).not.toBe("pass");
      expect(capturedRegression(JSON.parse(JSON.stringify(result.checks)))).toBe(result.regression);
    },
    240_000,
  );
});
