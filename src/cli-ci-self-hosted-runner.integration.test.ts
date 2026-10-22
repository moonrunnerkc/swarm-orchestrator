import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  capturedRegression,
  runnerWitnessHeld as derivedHeld,
} from "./evidence/verifier/status.mjs";
import type { RunnerWitness } from "./gates/runner-witness.ts";

const run = promisify(execFile);

/**
 * A project that is its own test runner, the way mocha is: `npm test` runs `node bin/run.mjs`,
 * which imports the project's `lib/report.mjs` to collect the test files, tally the outcomes and
 * print the summary, and the tests import the same file to test it. A change to that file is a
 * change to the instrument and to the code under test at once.
 *
 * The four controls: a legitimate change to the shared file stands as a pass; an incorrect one
 * fails; a change that also makes the runner swallow failures, or skip a test file, keeps its
 * pass withheld; and a change to how the check is configured (the test script) is read by the
 * base-configuration rule alone, never by the runner-source one. A check whose instrument the
 * change did not touch is not read again at all.
 */
let scratch = "";
let workspace = "";
let home = "";

async function git(...args: string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: workspace,
  });
  return ran.stdout.trim();
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(workspace, path, ".."), { recursive: true });
  await writeFile(join(workspace, path), contents, "utf8");
}

const runner = `import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collect, describeCount, tally } from "../lib/report.mjs";

const tests = [];
globalThis.it = (title, fn) => tests.push({ title, fn });
const files = collect(readdirSync("test").filter((name) => name.endsWith(".spec.mjs")).sort());
for (const file of files) await import(pathToFileURL(resolve("test", file)).href);
const outcomes = [];
for (const test of tests) {
  try {
    await test.fn();
    outcomes.push({ title: test.title, ok: true });
  } catch (error) {
    outcomes.push({ title: test.title, ok: false, message: String(error?.message ?? error) });
  }
}
for (const outcome of outcomes)
  if (!outcome.ok) console.log(\`failed: \${outcome.title}: \${outcome.message}\`);
const { passed, failed } = tally(outcomes);
console.log(\`\${describeCount(passed, "passing test")}, \${describeCount(failed, "failing test")}\`);
process.exitCode = failed > 0 ? 1 : 0;
`;

const collect = "export function collect(files) {\n  return files;\n}\n";
const tally = `export function tally(outcomes) {
  let passed = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.ok) passed += 1;
    else failed += 1;
  }
  return { passed, failed };
}
`;
const describeAtBase = `export function describeCount(count, noun) {
  return \`\${count} \${noun}\`;
}
`;
const describePlural = `export function describeCount(count, noun) {
  return \`\${count} \${noun}\${count === 1 ? "" : "s"}\`;
}
`;
const describeAlwaysPlural = `export function describeCount(count, noun) {
  return \`\${count} \${noun}s\`;
}
`;

const reportTestsAtBase = `import assert from "node:assert/strict";
import { describeCount, tally } from "../lib/report.mjs";

it("describes one", () => assert.equal(describeCount(1, "test"), "1 test"));
it("tallies", () => assert.deepEqual(tally([{ ok: true }, { ok: false }]), { passed: 1, failed: 1 }));
`;
const reportTestsWithPlural = `${reportTestsAtBase}it("describes several", () => assert.equal(describeCount(2, "test"), "2 tests"));\n`;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-ci-self-runner-"));
  workspace = join(scratch, "repo");
  home = join(scratch, "home");
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await write(
    "package.json",
    JSON.stringify({
      name: "self-runner",
      version: "1.0.0",
      type: "module",
      scripts: { test: "node bin/run.mjs", lint: "node scripts/lint.mjs" },
    }),
  );
  await write("bin/run.mjs", runner);
  await write("lib/report.mjs", `${collect}${tally}${describeAtBase}`);
  await write("scripts/lint.mjs", "console.log('lint clean');\n");
  await write("test/report.spec.mjs", reportTestsAtBase);
  await write(
    "test/other.spec.mjs",
    'import assert from "node:assert/strict";\n\nit("adds", () => assert.equal(1 + 1, 2));\n',
  );
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "base");
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function patchOf(edit: () => Promise<void>): Promise<string> {
  await edit();
  await git("add", "-A");
  const diff = await run("git", ["diff", "--cached", "--binary", "HEAD"], { cwd: workspace });
  await git("reset", "-q", "--hard", "HEAD");
  await git("clean", "-qfd");
  const path = join(scratch, `candidate-${Math.random().toString(16).slice(2)}.diff`);
  await writeFile(path, diff.stdout);
  return path;
}

interface CheckResult {
  readonly id: string;
  readonly status: string;
  readonly detail: string;
  readonly instrument?: unknown;
  readonly configurationObservation?: unknown;
  readonly runnerWitness?: RunnerWitness;
}

async function ci(patchPath: string) {
  let output = "";
  try {
    const ran = await run(
      process.execPath,
      [resolve("src/cli.ts"), "ci", "--workspace", workspace, "--patch", patchPath, "--json"],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
        timeout: 120_000,
      },
    );
    output = `${ran.stdout}${ran.stderr}`;
  } catch (cause) {
    const failed = cause as { stdout?: string; stderr?: string };
    output = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }
  const line = output.split("\n").find((one) => one.startsWith('{"schema":"swarm.ci.v1"'));
  if (line === undefined) throw new Error(`no swarm.ci.v1 line in:\n${output}`);
  const result = JSON.parse(line) as { checks: CheckResult[]; regression: string };
  // The dependency-free verifier re-derives every check's status from the record and must reach
  // the regression verdict the harness recorded.
  expect(capturedRegression(result.checks)).toBe(result.regression);
  const check = (id: string) => {
    const found = result.checks.find((one) => one.id === id);
    if (found === undefined) throw new Error(`no ${id} check in ${line}`);
    return found;
  };
  return { result, tests: check("tests"), lint: check("lint") };
}

describe("a project that runs its own tests with its own code", () => {
  it("lets a legitimate change to the shared runner source stand, and rereads nothing else", async () => {
    const { result, tests, lint } = await ci(
      await patchOf(async () => {
        await write("lib/report.mjs", `${collect}${tally}${describePlural}`);
        await write("test/report.spec.mjs", reportTestsWithPlural);
      }),
    );
    expect(tests.status).toBe("passed");
    expect(tests.detail).toContain("runner-source-v1");
    expect(tests.runnerWitness?.files).toEqual(["test/other.spec.mjs", "test/report.spec.mjs"]);
    // The verifier's own rule reaches the same answer from the record alone.
    expect(derivedHeld(tests.runnerWitness, tests.instrument)).toBe(true);
    expect(result.regression).toBe("pass");
    // lint's instrument is untouched by the change: its reading is the one that stands.
    expect(lint.status).toBe("passed");
    expect(lint.configurationObservation).toBeUndefined();
  }, 240_000);

  it("fails an incorrect change to the shared runner source", async () => {
    const { result, tests } = await ci(
      await patchOf(async () => {
        await write("lib/report.mjs", `${collect}${tally}${describeAlwaysPlural}`);
        await write("test/report.spec.mjs", reportTestsWithPlural);
      }),
    );
    expect(tests.status).toBe("failed");
    expect(result.regression).toBe("fail");
  }, 240_000);

  it("withholds the pass of a change whose runner swallows failures", async () => {
    const { result, tests } = await ci(
      await patchOf(async () => {
        await write(
          "lib/report.mjs",
          `${collect}export function tally(outcomes) {\n  return { passed: outcomes.length, failed: 0 };\n}\n${describeAlwaysPlural}`,
        );
        await write("test/report.spec.mjs", reportTestsWithPlural);
      }),
    );
    expect(tests.status).not.toBe("passed");
    expect(tests.runnerWitness).toBeDefined();
    expect(derivedHeld(tests.runnerWitness, tests.instrument)).toBe(false);
    expect(result.regression).not.toBe("pass");
  }, 240_000);

  it("withholds the pass of a change whose runner skips a test file", async () => {
    const { result, tests } = await ci(
      await patchOf(async () => {
        await write(
          "lib/report.mjs",
          `export function collect(files) {\n  return files.filter((file) => !file.startsWith("report"));\n}\n${tally}${describeAlwaysPlural}`,
        );
        await write("test/report.spec.mjs", reportTestsWithPlural);
      }),
    );
    expect(tests.status).not.toBe("passed");
    expect(tests.runnerWitness).toBeDefined();
    expect(derivedHeld(tests.runnerWitness, tests.instrument)).toBe(false);
    expect(result.regression).not.toBe("pass");
  }, 240_000);

  it("reads a changed test script by the base-configuration rule, never as runner source", async () => {
    const { result, tests } = await ci(
      await patchOf(async () => {
        await write(
          "package.json",
          JSON.stringify({
            name: "self-runner",
            version: "1.0.0",
            type: "module",
            scripts: { test: "node bin/run.mjs || true", lint: "node scripts/lint.mjs" },
          }),
        );
        await write("lib/report.mjs", `${collect}${tally}${describeAlwaysPlural}`);
      }),
    );
    expect(tests.status).not.toBe("passed");
    expect(tests.runnerWitness).toBeUndefined();
    expect(result.regression).not.toBe("pass");
  }, 240_000);
});
