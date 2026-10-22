import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * The standalone verifier on the case the 2026-10-21 accessor run reduced to: a lint
 * configuration lists one source file by literal path among the files it lints, only that file
 * changes, lint passes. The file a check reads is its subject, so the verifier lets the pass
 * stand; a patch that passes only by rewriting the configuration, or the program that performs
 * the check, is still read with the base's instrument and withheld.
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

const lintStandIn = [
  "import { readFileSync } from 'node:fs';",
  "const [configuration] = (await import('../eslint.config.js')).default;",
  "const flagged = configuration.files.filter((path) => readFileSync(path, 'utf8').includes('debugger'));",
  "if (flagged.length > 0) { console.error('debugger in ' + flagged.join(', ')); process.exit(1); }",
  "console.log('linted ' + configuration.files.length + ' file(s)');",
  "",
].join("\n");

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-ci-checked-"));
  workspace = join(scratch, "repo");
  home = join(scratch, "home");
  await mkdir(workspace, { recursive: true });
  await mkdir(home, { recursive: true });
  await write(
    "package.json",
    JSON.stringify({
      name: "w",
      version: "1.0.0",
      type: "module",
      scripts: { lint: "node tools/eslint.mjs", test: "node --test" },
    }),
  );
  await write("tools/eslint.mjs", lintStandIn);
  await write(
    "eslint.config.js",
    'export default [{ files: ["src/sum.js"], rules: { "no-debugger": "error" } }];\n',
  );
  await write("src/sum.js", "export const sum = (a, b) => a + b;\n");
  await write(
    "src/sum.test.mjs",
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from './sum.js';\ntest('sum', () => assert.equal(sum(1, 2), 3));\n",
  );
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "base");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function ci(patchPath: string) {
  try {
    const ran = await run(
      process.execPath,
      [
        resolve("src/swarm-verify.ts"),
        "ci",
        "--workspace",
        workspace,
        "--patch",
        patchPath,
        "--json",
      ],
      {
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" },
        timeout: 120_000,
      },
    );
    return { code: 0, output: `${ran.stdout}${ran.stderr}` };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
  }
}

function resultOf(output: string) {
  const line = output.split("\n").find((one) => one.startsWith('{"schema":"swarm.ci.v1"'));
  if (line === undefined) throw new Error(`no swarm.ci.v1 line in:\n${output}`);
  return JSON.parse(line) as {
    checks: {
      id: string;
      status: string;
      reportedStatus?: string;
      configurationFiles?: string[];
      configurationStatus?: string;
      instrument?: { files: { path: string }[]; residuals: string[] };
    }[];
    regression: string;
  };
}

async function patchOf(edit: () => Promise<void>): Promise<string> {
  await edit();
  await git("add", "-A");
  const diff = await run("git", ["diff", "--cached", "--binary", "HEAD"], { cwd: workspace });
  await git("reset", "-q", "--hard", "HEAD");
  await git("clean", "-qfd");
  const path = join(scratch, "candidate.diff");
  await writeFile(path, diff.stdout);
  return path;
}

describe("the files a lint configuration lists, read by swarm-verify ci", () => {
  it("lets a passing lint stand where only the listed source file changed", async () => {
    const patch = await patchOf(() =>
      write("src/sum.js", "export const sum = (a, b) => a + b + 0;\n"),
    );
    const ran = await ci(patch);
    const result = resultOf(ran.output);
    const lint = result.checks.find((check) => check.id === "lint");
    expect(lint?.status).toBe("passed");
    expect(lint?.reportedStatus).toBeUndefined();
    expect(lint?.configurationFiles).toBeUndefined();
    expect(lint?.instrument?.files.map((file) => file.path)).not.toContain("src/sum.js");
    expect(lint?.instrument?.residuals.join("\n")).toContain(
      "eslint.config.js names 1 file(s) in the tree as what its tool checks (src/sum.js)",
    );
    expect(result.regression).toBe("pass");
  }, 240_000);

  it("withholds a lint pass the patch's own configuration gives, with the base's configuration restored", async () => {
    const patch = await patchOf(async () => {
      await write("src/sum.js", "debugger; export const sum = (a, b) => a + b;\n");
      await write(
        "eslint.config.js",
        'export default [{ files: [], rules: { "no-debugger": "error" } }];\n',
      );
    });
    const ran = await ci(patch);
    const result = resultOf(ran.output);
    const lint = result.checks.find((check) => check.id === "lint");
    expect(lint?.reportedStatus).toBe("passed");
    expect(lint?.configurationFiles).toEqual(["eslint.config.js"]);
    expect(lint?.configurationStatus).toBe("failed");
    expect(lint?.status).not.toBe("passed");
    expect(result.regression).not.toBe("pass");
    expect(ran.code).not.toBe(0);
  }, 240_000);
});
