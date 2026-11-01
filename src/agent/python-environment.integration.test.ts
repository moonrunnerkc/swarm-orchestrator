import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { childEnvironment } from "swarm-verify/execution";
import { describe, expect, it } from "vitest";
import { preparePythonEnvironment } from "./python-environment.ts";
import { summaryLines } from "./report.ts";
import { bash, fixture, recordAndComplete, scripted, write } from "./test-doubles.ts";

/** uv on this process's PATH. Building from uv.lock is a supported workflow, so its absence fails. */
function uvPath(): string {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = join(directory, "uv");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error("uv is not on PATH: install it (https://docs.astral.sh/uv/) to run these tests");
}

// uv builds a uv_build project itself, so locking and installing this one needs no network.
const pyproject = `[project]
name = "mod"
version = "0.1.0"
requires-python = ">=3.9"

[build-system]
requires = ["uv_build>=0.8,<0.12"]
build-backend = "uv_build"
`;

const importProbe = `.venv/bin/python -c "import mod; print(mod.value, mod.__file__)"`;
const done = recordAndComplete([{ id: "R1", text: "x", kind: "other" }]);

/** A repository with an editable package `mod`, locked, and the user's own .venv synced from it. */
async function uvProject() {
  const uv = uvPath();
  const probe = await fixture({
    ".gitignore": ".venv/\n__pycache__/\n",
    "pyproject.toml": pyproject,
    "src/mod/__init__.py": "value = 1\n",
  });
  const env = {
    ...process.env,
    UV_CACHE_DIR: join(probe.root, "uv-cache"),
    UV_PYTHON_DOWNLOADS: "never",
  };
  execFileSync(uv, ["lock", "--offline", "--quiet"], { cwd: probe.repo, env });
  probe.git("add", "uv.lock");
  probe.git("commit", "-qm", "lock");
  execFileSync(uv, ["sync", "--offline", "--quiet"], { cwd: probe.repo, env });
  return probe;
}

/** The managed worktree a run used, which sits beside the repository and is named for its session. */
const worktreeOf = (repo: string, session: string) =>
  join(dirname(repo), `.${basename(repo)}.swarm-${basename(session)}`);

describe("the worktree's Python environment", () => {
  it("is built from uv.lock in the worktree, so the agent's python imports the worktree's source", async () => {
    const probe = await uvProject();
    const userPython = join(probe.repo, ".venv/bin/python");
    const own = execFileSync(userPython, ["-c", "import mod; print(mod.__file__)"], {
      encoding: "utf8",
    });
    expect(own.trim()).toMatch(/\/repo\/src\/mod\/__init__\.py$/);

    const model = scripted([write("src/mod/__init__.py", "value = 2"), bash(importProbe), done]);
    const ran = await probe.run(model);
    const worktree = worktreeOf(probe.repo, ran.sessionDirectory);
    const named = basename(worktree).replaceAll(".", "\\.");
    expect(model.seen[2]?.at(-1)?.content).toMatch(
      new RegExp(`^2 \\S*/${named}/src/mod/__init__\\.py$`, "m"),
    );

    const lock = await readFile(join(probe.repo, "uv.lock"));
    expect(ran.report.startingState.python).toMatchObject({
      state: "prepared",
      command: "uv sync --frozen",
      lockfile: { path: "uv.lock", sha256: createHash("sha256").update(lock).digest("hex") },
      limitation: null,
    });
    expect(ran.report.startingState.python?.interpreter).toMatch(
      new RegExp(`/${named}/\\.venv/bin/python$`),
    );
  });

  // ironroot (session 20261101T203914-4e0ccd): a pyproject.toml and an editable .venv, no uv.lock;
  // the agent ran with no environment at all while the verifier resolved one for itself.
  it("is resolved and built the verifier's way where the project has no uv.lock, and the lock stays out of the patch", async () => {
    const probe = await fixture({
      ".gitignore": ".venv/\n__pycache__/\n",
      "pyproject.toml": pyproject,
      "src/mod/__init__.py": "value = 1\n",
    });
    await mkdir(join(probe.repo, ".venv", "bin"), { recursive: true });
    const model = scripted([write("src/mod/__init__.py", "value = 2"), bash(importProbe), done]);
    const ran = await probe.run(model);

    expect(model.seen[2]?.at(-1)?.content).toMatch(/^2 \S*\/src\/mod\/__init__\.py$/m);
    expect(ran.report.startingState.python).toMatchObject({
      state: "prepared",
      command: "uv lock && uv sync --frozen --all-extras",
      lockfile: null,
      limitation: null,
    });
    expect(ran.report.changed.map((one) => one.path)).toEqual(["src/mod/__init__.py"]);
  });

  it("is not copied from the user's tree when there is nothing to build it from, and the run says so", async () => {
    const probe = await fixture({ ".gitignore": ".venv/\n" });
    await mkdir(join(probe.repo, ".venv", "bin"), { recursive: true });
    await writeFile(join(probe.repo, ".venv", "pyvenv.cfg"), "home = /usr/bin\n");
    const model = scripted([bash("ls -a"), done]);
    const ran = await probe.run(model);

    expect(model.seen[1]?.at(-1)?.content).not.toContain(".venv");
    const python = ran.report.startingState.python;
    expect(python).toMatchObject({ state: "not-prepared", command: null, interpreter: null });
    expect(python?.limitation).toBe(
      "the workspace has a .venv, but no uv.lock and no [verify] setup in swarm.toml to build the worktree's own from; the agent's commands ran without one. Add a uv.lock (`uv lock`) or declare the setup command",
    );
    expect(summaryLines(ran.report, { markdown: "/r.md" })).toContain(
      `python env   not prepared: ${python?.limitation}`,
    );
  });
});

/** A worktree holding the locked project beside a repository, and the environment a run gives. */
async function lockedWorktree(files: Readonly<Record<string, string>> = {}) {
  const root = await mkdtemp(join(tmpdir(), "python-env-"));
  const worktree = join(root, "worktree");
  const repository = join(root, "repo");
  await mkdir(join(worktree, "src", "mod"), { recursive: true });
  await mkdir(repository);
  const all = { "pyproject.toml": pyproject, "src/mod/__init__.py": "value = 1\n", ...files };
  for (const [path, text] of Object.entries(all)) await writeFile(join(worktree, path), text);
  const home = join(root, "home");
  await mkdir(home);
  execFileSync(uvPath(), ["lock", "--offline", "--quiet"], {
    cwd: worktree,
    env: { ...process.env, UV_CACHE_DIR: join(home, "uv-cache"), UV_PYTHON_DOWNLOADS: "never" },
  });
  const env = childEnvironment(process.env, { homeDir: home }).variables;
  const prepare = (over: Readonly<Record<string, string>> = {}) =>
    preparePythonEnvironment({
      worktree,
      repository,
      env: { ...env, ...over },
      deadline: Number.POSITIVE_INFINITY,
    });
  return { worktree, repository, prepare };
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe("preparing the worktree's Python environment", () => {
  it("runs the repository's declared setup in place of uv sync", async () => {
    const declared = "uv sync --frozen --offline";
    const tree = await lockedWorktree({ "swarm.toml": `[verify]\nsetup = "${declared}"\n` });
    expect(await tree.prepare()).toMatchObject({ state: "prepared", command: declared });
  });

  it("refuses an environment that imports from the user's tree, and leaves none behind", async () => {
    const setup =
      "uv sync --frozen --offline && for d in .venv/lib/python3*/site-packages; do echo $REPO/src > $d/user.pth; done";
    const tree = await lockedWorktree({ "swarm.toml": `[verify]\nsetup = '${setup}'\n` });
    await mkdir(join(tree.repository, "src"));
    const python = await tree.prepare({ REPO: tree.repository });
    expect(python).toMatchObject({ state: "not-prepared", interpreter: null });
    expect(python?.limitation).toMatch(
      /^the \.venv `uv sync .*` built imports from the user's tree \(\S+\/repo\/src\)/,
    );
    expect(await exists(join(tree.worktree, ".venv"))).toBe(false);
  });

  it("refuses a .venv whose python is another environment's interpreter", async () => {
    const setup = 'mkdir -p .venv/bin && ln -s "$(command -v python3)" .venv/bin/python';
    const tree = await lockedWorktree({ "swarm.toml": `[verify]\nsetup = '${setup}'\n` });
    const python = await tree.prepare();
    expect(python).toMatchObject({ state: "not-prepared", interpreter: null });
    expect(python?.limitation).toMatch(
      /^the \.venv `mkdir .*` built is not the worktree's own \(its prefix is \/\S+\)/,
    );
    expect(await exists(join(tree.worktree, ".venv"))).toBe(false);
  });

  it("says uv is missing rather than copying anything", async () => {
    const tree = await lockedWorktree();
    const python = await tree.prepare({ PATH: "/usr/bin:/bin" });
    expect(python).toMatchObject({ state: "not-prepared", command: "uv sync --frozen" });
    expect(python?.limitation).toBe(
      "uv is not on PATH, so `uv sync --frozen` could not build the worktree's .venv; the agent's commands ran without one. Install uv (https://docs.astral.sh/uv/) and run again",
    );
  });

  it("names the failed sync and removes what it left", async () => {
    const tree = await lockedWorktree();
    await writeFile(join(tree.worktree, "uv.lock"), "version = 1\n[[package]]\nname = 1\n");
    const python = await tree.prepare();
    expect(python?.state).toBe("not-prepared");
    expect(python?.limitation).toMatch(
      /^`uv sync --frozen` failed in the worktree \(exit \d+: .+\); the agent's commands ran without a \.venv/,
    );
    expect(await exists(join(tree.worktree, ".venv"))).toBe(false);
  });

  it("is not a concern of a project with neither a uv.lock nor a .venv", async () => {
    const root = await mkdtemp(join(tmpdir(), "python-env-none-"));
    expect(
      await preparePythonEnvironment({
        worktree: root,
        repository: root,
        env: {},
        deadline: Number.POSITIVE_INFINITY,
      }),
    ).toBeNull();
  });
});
