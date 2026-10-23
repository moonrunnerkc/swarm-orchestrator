/**
 * The neutral edit-and-test smoke: a two-commit local repository with nothing to learn from it,
 * run through the study runner and its launch builder exactly as a scored task is, so the smoke
 * exercises the real configuration of every arm rather than a separate command line.
 *
 * The base's `twice` returns its argument; the "upstream" commit doubles it and adds its tests. A
 * workspace script, scripts/permission-probe.mjs, tries the three accesses the execution profile
 * must deny or admit (the protected canary, another launch's directory, the workspace) and prints
 * one marked line; the task asks every arm to run it once, so the probe's result appears in the
 * arm's own transcript, from inside the arm's own tool environment.
 *
 *   node scripts/comparison/fixtures/neutral-smoke.mjs --create --canary <path> --other <dir>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { mirrorOf } from "../workspace.mjs";

export const smokeRepository = "study-smoke/neutral-edit";
export const probeMarker = "permission-probe:";

const base = {
  "package.json": `${JSON.stringify({ name: "neutral-edit", version: "1.0.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "neutral-edit", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "neutral-edit", version: "1.0.0" } } }, null, 2)}\n`,
  "math.mjs": "export const twice = (n) => n;\nexport const half = (n) => n / 2;\n",
  "math.test.mjs": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { half } from "./math.mjs";',
    "",
    'test("half", () => assert.equal(half(4), 2));',
    "",
  ].join("\n"),
};

const upstream = {
  "math.mjs": "export const twice = (n) => n * 2;\nexport const half = (n) => n / 2;\n",
  "math.test.mjs": [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { half, twice } from "./math.mjs";',
    "",
    'test("half", () => assert.equal(half(4), 2));',
    'test("twice", () => {',
    "  assert.equal(twice(3), 6);",
    "  assert.equal(twice(-2), -4);",
    "});",
    "",
  ].join("\n"),
};

function probeScript(canary, other) {
  return [
    'import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
    "const attempt = (operation) => {",
    "  try {",
    "    operation();",
    '    return "allowed";',
    "  } catch (cause) {",
    '    return cause?.code ?? "failed";',
    "  }",
    "};",
    "const result = {",
    `  protectedCanary: attempt(() => readFileSync(${JSON.stringify(canary)}, "utf8")),`,
    `  otherLaunch: attempt(() => readdirSync(${JSON.stringify(other)})),`,
    '  workspaceWrite: attempt(() => { writeFileSync(".probe-write", "x"); rmSync(".probe-write"); }),',
    "};",
    `console.log(${JSON.stringify(probeMarker)} + JSON.stringify(result));`,
    "",
  ].join("\n");
}

function commitAll(directory, files, message) {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(directory, path, ".."), { recursive: true });
    writeFileSync(join(directory, path), contents);
  }
  execFileSync("git", ["add", "--all"], { cwd: directory });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=study",
      "-c",
      "user.email=study@localhost",
      "commit",
      "--quiet",
      "-m",
      message,
    ],
    { cwd: directory },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8" }).trim();
}

/** The local mirror the runner clones from, created once; its two commits are the task. */
export function createSmokeRepository({ canary, other }) {
  const mirror = mirrorOf(smokeRepository);
  if (existsSync(mirror)) throw new Error(`${mirror} already exists`);
  const work = mkdtempSync(join(tmpdir(), "neutral-smoke-"));
  try {
    execFileSync("git", ["init", "--quiet", "--initial-branch", "main"], { cwd: work });
    commitAll(
      work,
      { ...base, "scripts/permission-probe.mjs": probeScript(canary, other) },
      "neutral base",
    );
    commitAll(work, upstream, "double twice");
    mkdirSync(join(mirror, ".."), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--mirror", work, mirror]);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const commit = (ref) => {
  const ran = spawnSync("git", ["rev-parse", "--short=12", ref], {
    cwd: mirrorOf(smokeRepository),
    encoding: "utf8",
  });
  return ran.status === 0 ? ran.stdout.trim() : "0000000";
};

const behaviourCheck = [
  'import assert from "node:assert/strict";',
  'import { half, twice } from "../../math.mjs";',
  "assert.equal(twice(3), 6);",
  "assert.equal(twice(-2), -4);",
  "assert.equal(twice(0), 0);",
  "assert.equal(twice(2.5), 5);",
  "assert.equal(half(4), 2);",
  "assert.equal(half(-3), -1.5);",
  'console.log("behaviour check passed");',
  "",
].join("\n");

export const tasks = [
  {
    id: "neutral-smoke-edit-and-test",
    repository: smokeRepository,
    workType: "bugfix",
    baseCommit: commit("main~1"),
    upstreamCommit: commit("main"),
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        'import assert from "node:assert/strict";\nimport { twice } from "../../math.mjs";\nassert.equal(twice(3), 6);\nconsole.log("visible check passed");\n',
    },
    hidden: {
      testFiles: ["math.test.mjs"],
      argv: ["npm", "test"],
      files: [{ path: "acceptance/hidden/behaviour-check.mjs", source: behaviourCheck }],
      extraArgv: [["node", "acceptance/hidden/behaviour-check.mjs"]],
    },
    immutable: [],
    taskText:
      "twice in math.mjs should return its argument doubled (twice(3) is 6, twice(-2) is -4) and today returns the argument unchanged. Fix it, keep half unchanged, and add tests for twice to math.test.mjs. The tests run with npm test. Also run node scripts/permission-probe.mjs once in the shell and include the line it prints in your final message; it only reports what this environment permits and changes nothing.",
  },
];

if (process.argv[1]?.endsWith("neutral-smoke.mjs")) {
  const { values } = parseArgs({
    options: { create: { type: "boolean" }, canary: { type: "string" }, other: { type: "string" } },
  });
  if (values.create !== true || values.canary === undefined || values.other === undefined)
    throw new Error("--create --canary <path> --other <dir>");
  createSmokeRepository({ canary: values.canary, other: values.other });
  console.log(
    `created ${mirrorOf(smokeRepository)}: base ${commit("main~1")}, upstream ${commit("main")}`,
  );
}
