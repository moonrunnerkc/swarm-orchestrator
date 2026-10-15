import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

/**
 * `swarm ci` judges a candidate in a fresh checkout of the base, so the only swarm.toml it
 * could read from the tree is the candidate's own. The configuration it honours is the base
 * commit's committed file: the merge target's declaration of how the project is checked.
 * A candidate that rewrites swarm.toml to a command that passes is judged by the base's
 * checks, and the report says the change was not read. The standalone binary shares the
 * implementation, so one verification reads the same through either entry.
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

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-ci-config-"));
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
      // The manifest's own test script fails, the way a browser suite without a browser does.
      scripts: { test: "node fail.mjs", "test-node": "node pass.mjs" },
    }),
  );
  await write("fail.mjs", "console.log('browser missing'); process.exit(1);\n");
  await write("pass.mjs", "console.log('node suite ok');\n");
  await write("greet.mjs", "export const greet = () => 'goodbye';\n");
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "base");
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function ci(entry: string, patchPath: string) {
  try {
    const ran = await run(
      process.execPath,
      [resolve(entry), "ci", "--workspace", workspace, "--patch", patchPath, "--json"],
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
    baseConfiguration: {
      present: boolean;
      overrides: Record<string, unknown> | null;
      changedByPatch: boolean;
    };
    checks: { id: string; status: string; observation?: { stdout: string } }[];
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

describe("the configuration swarm ci reads", () => {
  it("honours the base commit's committed swarm.toml, through either binary", async () => {
    await write("swarm.toml", '[gates]\ntests = "npm run test-node"\n');
    await git("add", "-A");
    await git("commit", "-qm", "configure the node suite as the tests gate");
    const patch = await patchOf(() => write("greet.mjs", "export const greet = () => 'hello';\n"));

    for (const entry of ["src/cli.ts", "src/swarm-verify.ts"]) {
      const ran = await ci(entry, patch);
      const result = resultOf(ran.output);
      expect(result.baseConfiguration).toMatchObject({
        present: true,
        overrides: { tests: "npm run test-node" },
        changedByPatch: false,
      });
      const tests = result.checks.find((check) => check.id === "tests");
      expect(tests?.status).toBe("passed");
      expect(tests?.observation?.stdout).toContain("node suite ok");
      expect(result.regression).toBe("pass");
    }
  }, 240_000);

  it("refuses to let the candidate's own swarm.toml redefine the checks, and says so", async () => {
    // No configuration at the base: the manifest's failing script is the tests gate.
    const patch = await patchOf(async () => {
      await write("greet.mjs", "export const greet = () => 'hello';\n");
      await write("swarm.toml", '[gates]\ntests = "npm run test-node"\n');
    });

    const ran = await ci("src/cli.ts", patch);
    const result = resultOf(ran.output);
    expect(ran.code).not.toBe(0);
    expect(result.baseConfiguration).toMatchObject({
      present: false,
      overrides: null,
      changedByPatch: true,
    });
    const tests = result.checks.find((check) => check.id === "tests");
    expect(tests?.status).toBe("failed");
    expect(tests?.observation?.stdout).toContain("browser missing");
    expect(result.regression).not.toBe("pass");

    const text = await run(
      process.execPath,
      [resolve("src/cli.ts"), "ci", "--workspace", workspace, "--patch", patch],
      { cwd: workspace, env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1" } },
    ).catch((failed: { stdout?: string }) => ({ stdout: failed.stdout ?? "" }));
    expect(text.stdout).toContain(
      "configuration: checks from the manifests; the base has no swarm.toml",
    );
    expect(text.stdout).toContain(
      "the patch changes swarm.toml, and that change does not decide the checks",
    );
  }, 240_000);

  it("judges by the base's command even where the candidate weakens the committed file", async () => {
    await write("swarm.toml", '[gates]\ntests = "node fail.mjs"\n');
    await git("add", "-A");
    await git("commit", "-qm", "the base's tests gate fails");
    const patch = await patchOf(async () => {
      await write("greet.mjs", "export const greet = () => 'hello';\n");
      await write("swarm.toml", '[gates]\ntests = "node pass.mjs"\n');
    });

    const ran = await ci("src/cli.ts", patch);
    const result = resultOf(ran.output);
    expect(result.baseConfiguration).toMatchObject({
      present: true,
      overrides: { tests: "node fail.mjs" },
      changedByPatch: true,
    });
    expect(result.checks.find((check) => check.id === "tests")?.status).toBe("failed");
    expect(ran.code).not.toBe(0);
  }, 240_000);
});
