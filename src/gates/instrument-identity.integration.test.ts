import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { capturedRegression } from "../evidence/verifier/status.mjs";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/**
 * SV-01: a candidate's own files choosing the instrument that measures it. Every case runs the
 * real Vitest this repository installs (linked into each fixture, so no registry is reached), the
 * way the published 1.0.7 was shown to accept: a configuration that writes a passing report and
 * exits before any test runs, and the variants a filename list could not see. Each has a valid
 * counterpart that must still pass or fail on its merits.
 */
const run = promisify(execFile);
let scratch = "";
let root = "";

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-instrument-"));
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

const marker = "MARKER";

/** A real failing test that leaves a marker behind when it runs. */
const failingTest = [
  'import { expect, test } from "vitest";',
  'import { writeFileSync } from "node:fs";',
  'test("runs", () => {',
  `  writeFileSync(new URL("./${marker}", import.meta.url), "ran");`,
  "  expect(1).toBe(2);",
  "});",
  "",
].join("\n");

/** Writes a passing report to Vitest's --outputFile and exits before any test runs. */
const forgery = [
  'import { writeFileSync } from "node:fs";',
  "export function forge() {",
  '  const flag = process.argv.find((arg) => arg.startsWith("--outputFile="));',
  "  if (!flag) return;",
  '  writeFileSync(flag.slice("--outputFile=".length), JSON.stringify({ numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, success: true, testResults: [{ name: process.cwd() + "/sum.test.js", assertionResults: [{ fullName: "runs", title: "runs", status: "passed", failureMessages: [] }] }] }));',
  "  process.exit(0);",
  "}",
  "",
].join("\n");

async function fixture(
  scripts: Readonly<Record<string, string>> = { test: "vitest run" },
): Promise<void> {
  root = await mkdtemp(join(scratch, "repo-"));
  git(["init", "-q"]);
  await put(
    "package.json",
    `${JSON.stringify({ name: "w", private: true, type: "module", scripts, devDependencies: { vitest: "4.1.11" } }, null, 2)}\n`,
  );
  await put("sum.test.js", failingTest);
  await put(".gitignore", `node_modules\n${marker}\n`);
  await symlink(resolve("node_modules"), join(root, "node_modules"));
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
}

async function check(): Promise<{ code: number; report: Record<string, unknown> }> {
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
    SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
  };
  try {
    const ran = await run(
      process.execPath,
      [resolve("src/swarm-verify.ts"), "check", "--json", "--workspace", root],
      {
        env: environment,
        timeout: 120_000,
        maxBuffer: 16_000_000,
      },
    );
    return { code: 0, report: JSON.parse(ran.stdout) };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string };
    return { code: failed.code ?? 1, report: JSON.parse(failed.stdout ?? "{}") };
  }
}

type Conclusions = {
  checks: { id: string; status: string; detail: string }[];
};

function testsCheck(report: Record<string, unknown>) {
  return (report.conclusions as Conclusions).checks.find((one) => one.id === "tests");
}

describe("check refuses a pass the candidate's instrument reported", () => {
  beforeEach(async () => {
    await fixture();
  });

  it("runs the real failing test and fails without any configuration (the clean control)", async () => {
    const { code, report } = await check();
    expect(report.result).toBe("fail");
    expect(code).toBe(1);
    expect(existsSync(join(root, marker))).toBe(true);
  }, 120_000);

  it("does not pass a vitest.config.mjs that forges the report (the 1.0.7 reproduction)", async () => {
    await put("forge.mjs", forgery);
    await put(
      "vitest.config.mjs",
      'import { forge } from "./forge.mjs";\nforge();\nexport default {};\n',
    );
    const { code, report } = await check();
    expect(existsSync(join(root, marker))).toBe(false);
    expect(report.result).toBe("incomplete");
    expect(code).toBe(4);
    expect(testsCheck(report)?.status).toBe("not-applicable");
    expect(testsCheck(report)?.detail).toContain("vitest.config.mjs");
  }, 120_000);

  it("does not pass an unchanged configuration whose imported helper the change rewrote", async () => {
    await put("tools/options.mjs", "export const options = {};\n");
    await put(
      "vitest.config.mjs",
      'import { options } from "./tools/options.mjs";\nexport default { test: options };\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "a configuration that imports a helper"]);
    await put("forge.mjs", forgery);
    await put(
      "tools/options.mjs",
      'import { forge } from "../forge.mjs";\nforge();\nexport const options = {};\n',
    );
    const { report } = await check();
    expect(existsSync(join(root, marker))).toBe(false);
    expect(report.result).toBe("incomplete");
    expect(testsCheck(report)?.detail).toContain("tools/options.mjs");
  }, 120_000);

  it("does not pass a setup file under a name no list anticipates that makes every assertion pass", async () => {
    await put("tools/prime.mjs", "export {};\n");
    await put(
      "vitest.config.mjs",
      'export default { test: { setupFiles: ["./tools/prime.mjs"] } };\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "a setup file"]);
    await put(
      "tools/prime.mjs",
      'import { expect } from "vitest";\nexpect.extend({ toBe: () => ({ pass: true, message: () => "" }) });\n',
    );
    const { report } = await check();
    expect(existsSync(join(root, marker))).toBe(true);
    expect(report.result).toBe("incomplete");
    expect(testsCheck(report)?.detail).toContain("tools/prime.mjs");
  }, 120_000);

  it("does not pass a test script replaced by an echo of a passing summary", async () => {
    await fixture({ test: "vitest run --passWithNoTests" });
    await put(
      "package.json",
      `${JSON.stringify({ name: "w", private: true, type: "module", scripts: { test: 'echo "Tests  1 passed (1)"' }, devDependencies: { vitest: "4.1.11" } }, null, 2)}\n`,
    );
    const { report } = await check();
    expect(report.result).toBe("incomplete");
    expect(testsCheck(report)?.detail).toContain("package.json#scripts.test");
  }, 120_000);

  it("does not pass a runner the manifest now takes from a path in the tree", async () => {
    await put(
      "package.json",
      `${JSON.stringify({ name: "w", private: true, type: "module", scripts: { test: "vitest run" }, devDependencies: { vitest: "file:./vendor/vitest" } }, null, 2)}\n`,
    );
    await put("forge.mjs", forgery);
    await put(
      "vitest.config.mjs",
      'import { forge } from "./forge.mjs";\nforge();\nexport default {};\n',
    );
    const { report } = await check();
    expect(report.result).toBe("incomplete");
    expect(testsCheck(report)?.detail).toContain("package.json#devDependencies:vitest");
  }, 120_000);

  it("still passes real work under a committed configuration, and still fails a real failure", async () => {
    await put("tools/prime.mjs", "export {};\n");
    await put(
      "vitest.config.mjs",
      'export default { test: { setupFiles: ["./tools/prime.mjs"] } };\n',
    );
    await put("sum.js", "export const sum = (a, b) => a + b;\n");
    await put(
      "sum.test.js",
      'import { expect, test } from "vitest";\nimport { sum } from "./sum.js";\ntest("adds", () => expect(sum(1, 2)).toBe(3));\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "working code"]);
    const clean = await check();
    expect(clean.report.result).toBe("pass");
    expect(clean.code).toBe(0);

    await put("sum.js", "export const sum = (a, b) => a * b + 1;\n");
    const edited = await check();
    expect(edited.report.result).toBe("pass");

    await put("sum.js", "export const sum = (a, b) => a - b;\n");
    const broken = await check();
    expect(broken.report.result).toBe("fail");
    expect(broken.code).toBe(1);
  }, 180_000);
});

describe("ci measures a changed instrument with the base's instrument", () => {
  const clock = { now: () => 0, sleep: () => Promise.resolve() };

  it("runs the base's test script where the patch replaced it with an echo", async () => {
    await fixture({ test: "vitest run --passWithNoTests" });
    await put("sum.js", "export const sum = (a, b) => a + b;\n");
    await put(
      "sum.test.js",
      'import { expect, test } from "vitest";\nimport { sum } from "./sum.js";\ntest("adds", () => expect(sum(1, 2)).toBe(3));\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "working code"]);
    const base = git(["rev-parse", "HEAD"]);
    await put("sum.js", "export const sum = (a, b) => a - b;\n");
    await put(
      "package.json",
      `${JSON.stringify({ name: "w", private: true, type: "module", scripts: { test: 'echo "Tests  1 passed (1)"' }, devDependencies: { vitest: "4.1.11" } }, null, 2)}\n`,
    );
    const patch = git(["diff"]);
    git(["checkout", "--", "."]);

    const result = await verifyIndependently({
      repositoryRoot: root,
      baseCommit: base,
      patch: `${patch}\n`,
      commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
      clock,
    });
    const tests = result.checks.find((one) => one.id === "tests");
    expect(tests?.reportedStatus).toBe("passed");
    expect(tests?.configurationStatus).toBe("failed");
    // Vitest's text reporter names the failing test but no passing ones, so the failure under the
    // base's script is not proven to be in a test the base had: the pass is withheld, unmeasured.
    expect(tests?.status).toBe("not-applicable");
    expect(result.regression).toBe("unmeasured");
    expect(result.verified).toBe(false);
    expect(capturedRegression(result.checks)).toBe("unmeasured");
  }, 180_000);

  it("lets a harmless script edit stand once the base's script also passes it", async () => {
    await fixture({ test: "vitest run --passWithNoTests" });
    await put("sum.js", "export const sum = (a, b) => a + b;\n");
    await put(
      "sum.test.js",
      'import { expect, test } from "vitest";\nimport { sum } from "./sum.js";\ntest("adds", () => expect(sum(1, 2)).toBe(3));\n',
    );
    git(["add", "-A"]);
    git(["commit", "-qm", "working code"]);
    const base = git(["rev-parse", "HEAD"]);
    await put(
      "package.json",
      `${JSON.stringify({ name: "w", private: true, type: "module", scripts: { test: "vitest run --passWithNoTests --silent" }, devDependencies: { vitest: "4.1.11" } }, null, 2)}\n`,
    );
    const patch = git(["diff"]);
    git(["checkout", "--", "."]);

    const result = await verifyIndependently({
      repositoryRoot: root,
      baseCommit: base,
      patch: `${patch}\n`,
      commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
      clock,
    });
    const tests = result.checks.find((one) => one.id === "tests");
    expect(tests?.configurationStatus).toBe("passed");
    expect(tests?.status).toBe("passed");
    expect(result.regression).toBe("pass");
    expect(capturedRegression(result.checks)).toBe("pass");
  }, 180_000);
});
