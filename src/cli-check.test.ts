import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkSchemaName } from "./cli-check.ts";

const run = promisify(execFile);

/**
 * The first-run command, driven through the standalone binary's entry point with no
 * subcommand, under an environment holding no key and no configuration. Every fixture is a
 * real repository and every run is a real process, because what this command promises is a
 * result with nothing configured, and the only way to hold it to that is to configure nothing.
 */
let scratch = "";

async function repository(name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = join(scratch, name);
  await mkdir(root, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  const git = (args: readonly string[]) =>
    run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root });
  await git(["init", "-q"]);
  await git(["add", "-A"]);
  await git(["commit", "-qm", "base"]);
  return root;
}

const nodeTestFixture = {
  "package.json":
    '{ "name": "w", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n',
  "double.mjs": "export const double = (n) => n * 2;\n",
  "double.test.mjs": [
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'import { double } from "./double.mjs";',
    'test("doubles", () => assert.equal(double(2), 4));',
    "",
  ].join("\n"),
};

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-check-"));
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function verifier(
  args: readonly string[],
): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
  const environment = {
    PATH: process.env.PATH ?? "",
    HOME: join(scratch, "home"),
    NO_COLOR: "1",
    SWARM_LOCAL_BASE_URL: "http://127.0.0.1:9",
  };
  try {
    const ran = await run(process.execPath, [resolve("src/swarm-verify.ts"), ...args], {
      env: environment,
      timeout: 120_000,
      maxBuffer: 8_000_000,
    });
    return { code: 0, stdout: ran.stdout, stderr: ran.stderr };
  } catch (cause) {
    const failed = cause as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? 1, stdout: failed.stdout ?? "", stderr: failed.stderr ?? "" };
  }
}

/**
 * A committed Python project beside an ignored `.venv` whose interpreter is a shell stand-in:
 * each `branches` line answers one `python -m` invocation, and anything else exits 2, so a check
 * the project did not declare cannot pass by accident. Returns the check report's conclusions.
 */
async function checkedPythonProject(
  name: string,
  files: Readonly<Record<string, string>>,
  installed: readonly string[],
  branches: readonly string[],
): Promise<(id: string) => { id: string; status: string; detail: string } | undefined> {
  const environment: Record<string, string> = { ".venv/pyvenv.cfg": "home = /usr/bin\n" };
  for (const tool of installed)
    environment[`.venv/lib/python3.12/site-packages/${tool}/__init__.py`] = "";
  const root = await repository(name, {
    ".gitignore": ".venv/\n",
    ...files,
    ...environment,
    ".venv/bin/python": ["#!/bin/sh", ...branches, 'echo "unexpected: $*" >&2; exit 2', ""].join(
      "\n",
    ),
  });
  await chmod(join(root, ".venv/bin/python"), 0o755);
  const ran = await verifier(["--workspace", root, "--json"]);
  const report = JSON.parse(ran.stdout.trim()) as {
    conclusions: { checks: readonly { id: string; status: string; detail: string }[] };
  };
  return (id) => report.conclusions.checks.find((one) => one.id === id);
}

describe("swarm-verify with no subcommand", () => {
  it("checks a repository, prints five conclusions, and exits 0 as a regression-only pass", async () => {
    const root = await repository("passing", nodeTestFixture);
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("command      npm run --silent test [node --test]");
    expect(ran.stdout).toContain("ran: exited 0");
    expect(ran.stdout).toMatch(/^checks {7}passed \d+ \(tests/m);
    expect(ran.stdout).toContain("execution    restricted");
    expect(ran.stdout).toContain("requirements unmeasured");
    expect(ran.stdout).toContain("challenges   none");
    expect(ran.stdout).toContain("result       regression-only pass");
    expect(ran.stdout).toContain("evidence     ");
    expect(ran.code).toBe(0);
    // Nothing was written into the workspace: no swarm.toml, no bundle, no scratch.
    expect((await readdir(root)).sort()).toEqual([
      ".git",
      "double.mjs",
      "double.test.mjs",
      "package.json",
    ]);
  });

  it("emits one versioned JSON object under --json with the same conclusions", async () => {
    const root = await repository("json", nodeTestFixture);
    const ran = await verifier(["--workspace", root, "--json"]);
    const report = JSON.parse(ran.stdout.trim()) as {
      schema: string;
      result: string;
      exitCode: number;
      plan: { tests: { runner: string } };
      conclusions: {
        checks: readonly { id: string; status: string }[];
        command: { status: string };
      };
    };
    expect(report.schema).toBe(checkSchemaName);
    expect(report.result).toBe("pass");
    expect(report.exitCode).toBe(0);
    expect(report.plan.tests.runner).toBe("node-test");
    expect(report.conclusions.command.status).toBe("ran");
    expect(report.conclusions.checks.find((one) => one.id === "tests")?.status).toBe("passed");
    expect(ran.code).toBe(0);
  });

  it("exits 1 when a declared check fails, and says which", async () => {
    const root = await repository("failing", {
      ...nodeTestFixture,
      "double.mjs": "export const double = (n) => n + n + 1;\n",
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("failed 1 (tests)");
    expect(ran.stdout).toContain("result       fail");
    expect(ran.code).toBe(1);
  });

  it("builds before testing, as a project's own CI does, when the suite reads build output", async () => {
    // Found by a fresh-VM onboarding run on a Vite and Workers project whose test script reads
    // the built asset directory: the suite ran before the build and a clean tree read as failed.
    const root = await repository("built", {
      "package.json":
        '{ "name": "b", "version": "1.0.0", "type": "module", "scripts": { "build": "node build.mjs", "test": "node --test" } }\n',
      ".gitignore": "dist/\n",
      "build.mjs":
        'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\nwriteFileSync("dist/double.mjs", "export const double = (n) => n * 2;\\n");\n',
      "double.test.mjs": [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { double } from "./dist/double.mjs";',
        'test("doubles", () => assert.equal(double(2), 4));',
        "",
      ].join("\n"),
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("result       regression-only pass");
    expect(ran.code).toBe(0);
  });

  it("builds before typechecking a workspace whose type declarations only the build writes", async () => {
    // depose's per-package `tsc --noEmit` resolves its workspace dependencies through the
    // `dist/index.d.ts` that `tsc --build` writes, and its CI builds first. Typechecked before
    // the build, a clean tree read as a failed typecheck.
    const files = {
      "package.json":
        '{ "name": "d", "version": "1.0.0", "type": "module", "scripts": { "build": "node build.mjs", "typecheck": "node typecheck.mjs", "test": "node --test" } }\n',
      ".gitignore": "dist/\n",
      "build.mjs":
        'import { mkdirSync, writeFileSync } from "node:fs";\nmkdirSync("dist", { recursive: true });\nwriteFileSync("dist/index.d.ts", "export declare const double: (n: number) => number;\\n");\n',
      "typecheck.mjs":
        'import { existsSync } from "node:fs";\nif (!existsSync("dist/index.d.ts")) { console.error("error TS2307: Cannot find module \'@d/core\' or its corresponding type declarations."); process.exit(2); }\n',
      "double.test.mjs": nodeTestFixture["double.test.mjs"],
      "double.mjs": nodeTestFixture["double.mjs"],
    };
    const root = await repository("typecheck-reads-build", files);
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("result       regression-only pass");
    expect(ran.code).toBe(0);
    // The control: a typecheck that fails whatever the build wrote still fails.
    const broken = await repository("typecheck-broken", {
      ...files,
      "typecheck.mjs":
        'console.error("error TS2322: Type string is not assignable");\nprocess.exit(2);\n',
    });
    const refused = await verifier(["--workspace", broken]);
    expect(refused.stdout).toContain("failed 1 (typecheck)");
    expect(refused.code).toBe(1);
  });

  it("runs a vitest project once under CI=true and reads its structured outcome", async () => {
    const root = await repository("vitest", {
      "package.json":
        '{ "name": "v", "type": "module", "scripts": { "test": "vitest" }, "devDependencies": { "vitest": "4.1.11" } }\n',
      "triple.mjs": "export const triple = (n) => n * 3;\n",
      "triple.test.mjs": [
        'import { expect, test } from "vitest";',
        'import { triple } from "./triple.mjs";',
        'test("triples", () => expect(triple(2)).toBe(6));',
        "",
      ].join("\n"),
      ".gitignore": "node_modules\n",
    });
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("CI=true, which vitest reads as run mode");
    expect(ran.stdout).toContain("1 runner-reported tests, 1 executed");
    expect(ran.code).toBe(0);
  });

  it("checks formatting only with a formatter the project declares", async () => {
    // A project environment whose ruff lints clean and whose `ruff format --check` would
    // reformat a file, as nborder's and tavern's did: they lint with ruff and never format with it.
    const ruff = [
      'if [ "$1 $2 $3" = "-m ruff format" ]; then echo "Would reformat: app.py"; exit 1; fi',
      'if [ "$1 $2 $3" = "-m ruff check" ]; then echo "All checks passed!"; exit 0; fi',
    ];
    const linted = await checkedPythonProject(
      "ruff-lint-only",
      { "pyproject.toml": '[project]\nname = "p"\n[tool.ruff]\n', "app.py": "value = {'a':1}\n" },
      ["ruff"],
      ruff,
    );
    expect(linted("lint")?.status).toBe("passed");
    expect(linted("format")?.status).toBe("not-applicable");
    expect(linted("format")?.detail).toContain("declares no formatter");

    // The control: where the project does declare ruff as its formatter, the same unformatted
    // file is still a blocking failure.
    const formatted = await checkedPythonProject(
      "ruff-format-declared",
      {
        "pyproject.toml":
          '[project]\nname = "p"\n[tool.ruff]\n[tool.ruff.format]\nquote-style = "double"\n',
        "app.py": "value = {'a':1}\n",
      },
      ["ruff"],
      ruff,
    );
    expect(formatted("format")?.status).toBe("failed");
  });

  it("runs mypy on the targets mypy.ini names rather than on the whole tree", async () => {
    // ironroot scopes mypy with `files = src` in mypy.ini; `mypy .` also checked its tests and
    // reported 180 errors there. This environment's mypy fails a whole-tree run the same way,
    // and checks `src` alone when given no target, failing only where `src` holds an error.
    const mypy = [
      'if [ "$*" = "-m mypy ." ]; then echo "tests/test_app.py: error: 180 errors"; exit 1; fi',
      'if [ "$*" = "-m mypy" ]; then if [ -e src/broken.py ]; then echo "src/broken.py:1: error"; exit 1; fi; echo "Success"; exit 0; fi',
    ];
    const files = {
      "pyproject.toml": '[project]\nname = "p"\n[dependency-groups]\ndev = ["mypy>=1.10"]\n',
      "mypy.ini": "[mypy]\nfiles = src\nstrict = True\n",
      "src/app.py": "def double(n: int) -> int:\n    return n * 2\n",
    };
    const scoped = await checkedPythonProject("mypy-scoped", files, ["mypy"], mypy);
    expect(scoped("typecheck")?.status).toBe("passed");

    // The control: a type error inside the scope mypy.ini names still fails the check.
    const broken = await checkedPythonProject(
      "mypy-scoped-broken",
      { ...files, "src/broken.py": "value: int = 'text'\n" },
      ["mypy"],
      mypy,
    );
    expect(broken("typecheck")?.status).toBe("failed");
  });

  describe("an untracked Python virtual environment beside the project", () => {
    // The AWS documentation's example key id, which the secret scan blocks on.
    const credential = 'AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"\n';
    const pyvenv = "home = /usr/bin\ninclude-system-site-packages = false\nversion = 3.12.3\n";
    const place = async (root: string, files: Readonly<Record<string, string>>) => {
      for (const [path, content] of Object.entries(files)) {
        await mkdir(join(root, path, ".."), { recursive: true });
        await writeFile(join(root, path), content);
      }
    };
    const committer = (root: string) => (args: readonly string[]) =>
      run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: root });

    /**
     * tavern on a fresh machine: `python3 -m venv .venv` (3.12, no `.gitignore` inside), a
     * `.gitignore` naming `venv/` but not `.venv/`, and `check` on the clean tree measured 81
     * changed files under `.venv/`, failing the placeholder, secret and diff-budget checks.
     */
    it("leaves it out of the change and names it, on an otherwise clean tree", async () => {
      const root = await repository("venv-untracked", {
        ...nodeTestFixture,
        ".gitignore": "venv/\nenv/\n",
      });
      const environment: Record<string, string> = {
        ".venv/pyvenv.cfg": pyvenv,
        ".venv/lib/python3.12/site-packages/boto_stub/config.py": credential,
        ".venv/lib/python3.12/site-packages/boto_stub/todo.py": "# TODO: vendored upstream\n",
      };
      for (let index = 0; index < 14; index += 1)
        environment[`.venv/lib/python3.12/site-packages/dep${index}/__init__.py`] = "x = 1\n";
      await place(root, environment);

      const ran = await verifier(["--workspace", root]);
      expect(ran.stdout).toContain(
        "excluded     .venv/: an untracked directory holding pyvenv.cfg is a Python virtual environment",
      );
      expect(ran.stdout).not.toMatch(/failed [1-9]/);
      expect(ran.stdout).toContain("result       regression-only pass");
      expect(ran.code).toBe(0);
    });

    it("still checks a tracked directory that holds a pyvenv.cfg", async () => {
      const root = await repository("venv-tracked", {
        ...nodeTestFixture,
        "env/pyvenv.cfg": pyvenv,
        "env/settings.mjs": "export const region = 'us-east-1';\n",
      });
      await place(root, { "env/leak.mjs": credential });
      const ran = await verifier(["--workspace", root]);
      expect(ran.stdout).not.toContain("excluded ");
      expect(ran.stdout).toMatch(/failed \d+ \([^)]*secret-scan/);
      expect(ran.code).toBe(1);
    });

    it("still checks source beside a pyvenv.cfg the person staged", async () => {
      const root = await repository("venv-staged", nodeTestFixture);
      await place(root, { "lib/pyvenv.cfg": pyvenv, "lib/leak.mjs": credential });
      await committer(root)(["add", "lib/pyvenv.cfg"]);
      const ran = await verifier(["--workspace", root]);
      expect(ran.stdout).not.toContain("excluded ");
      expect(ran.stdout).toMatch(/failed \d+ \([^)]*secret-scan/);
      expect(ran.code).toBe(1);
    });

    it("never hides a patch's source in ci, even where the patch adds a pyvenv.cfg beside it", async () => {
      const root = await repository("venv-patch", nodeTestFixture);
      await place(root, { "lib/pyvenv.cfg": pyvenv, "lib/leak.mjs": credential });
      const git = committer(root);
      await git(["add", "-A"]);
      const patch = (await git(["diff", "--cached", "--binary", "HEAD"])).stdout;
      await git(["reset", "-q", "--hard", "HEAD"]);
      const patchFile = join(scratch, "venv-patch.diff");
      await writeFile(patchFile, patch);

      const ran = await verifier(["ci", "--patch", patchFile, "--workspace", root, "--json"]);
      const report = JSON.parse(ran.stdout.trim().split("\n").at(-1) ?? "{}") as {
        changedPaths?: readonly string[];
      };
      expect(report.changedPaths).toEqual(["lib/leak.mjs", "lib/pyvenv.cfg"]);
      expect(ran.stdout).not.toContain("excluded-environments");
    });
  });

  it("exits 4 without running a test script that asks for watch mode", async () => {
    const root = await repository("watch", {
      "package.json": '{ "name": "w", "scripts": { "test": "vitest --watch" } }\n',
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("asks for watch mode (--watch)");
    expect(ran.stdout).toContain("result       incomplete");
    expect(ran.code).toBe(4);
  });

  it("exits 4 with the exact next step when dependencies are declared and not installed", async () => {
    const root = await repository("uninstalled", {
      "package.json":
        '{ "name": "u", "scripts": { "test": "vitest" }, "devDependencies": { "vitest": "4.1.11" } }\n',
      "package-lock.json": "{}\n",
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("run `npm ci` in the workspace, then run again");
    expect(ran.code).toBe(4);
  });

  it("exits 4 for a directory with no manifest and for a directory that is not a repository", async () => {
    const bare = await repository("bare", { "README.md": "hello\n" });
    const noManifest = await verifier(["--workspace", bare]);
    expect(noManifest.stdout).toContain("no package.json, pyproject.toml");
    expect(noManifest.code).toBe(4);

    const plain = join(scratch, "plain");
    await mkdir(plain, { recursive: true });
    await writeFile(join(plain, "package.json"), '{ "scripts": { "test": "node --test" } }\n');
    const notGit = await verifier(["--workspace", plain]);
    expect(notGit.stdout).toContain("not a git repository");
    expect(notGit.code).toBe(4);
  });

  it("names the packages and the override when a workspace has no root test script", async () => {
    const root = await repository("monorepo", {
      "package.json": '{ "name": "m", "workspaces": ["packages/*"] }\n',
      "packages/a/package.json": '{ "name": "a", "scripts": { "test": "node --test" } }\n',
    });
    const ran = await verifier(["--workspace", root]);
    expect(ran.stdout).toContain("--package <dir>: packages/a");
    expect(ran.code).toBe(4);
  });

  it("prints the plan and runs nothing under --explain", async () => {
    const root = await repository("explain", nodeTestFixture);
    const ran = await verifier(["--workspace", root, "--explain"]);
    expect(ran.stdout).toContain("result       preview only; nothing ran (exit 0)");
    expect(ran.stdout).not.toContain("evidence     ");
    expect(ran.code).toBe(0);
  });

  it("exits 2 for a command line it cannot read", async () => {
    const ran = await verifier(["nonsense"]);
    expect(ran.stderr).toContain('"nonsense" is not a command this binary has');
    expect(ran.code).toBe(2);
  });
});
