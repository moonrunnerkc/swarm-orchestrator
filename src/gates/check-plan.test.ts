import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planCheck } from "./check-plan.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-check-plan-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: string): Promise<void> {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), content);
}

/** A PATH holding node and npm, so a plan is about the project rather than this machine. */
async function toolPath(): Promise<string> {
  const bin = join(root, ".bin");
  await mkdir(bin, { recursive: true });
  for (const program of ["node", "npm", "pnpm", "uv"]) await writeFile(join(bin, program), "");
  return bin;
}

describe("planning a check from a project's files", () => {
  it("reads a node project's test script, manager and lockfile, and needs no install without dependencies", async () => {
    await write("package.json", '{"scripts":{"test":"node --test"}}');
    await write("package-lock.json", "{}");
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.scope.kind).toBe("root");
    expect(plan.project.nodeManager).toBe("npm");
    expect(plan.project.lockfiles).toEqual(["package-lock.json"]);
    expect(plan.tests).toMatchObject({ script: "test", body: "node --test", runner: "node-test" });
    expect(plan.prerequisites).toEqual([]);
    expect(plan.unmeasured.map((one) => one.area)).toContain("task correctness");
  });

  it("names the missing install as the prerequisite when dependencies are declared and absent", async () => {
    await write("package.json", '{"scripts":{"test":"vitest"},"devDependencies":{"vitest":"4"}}');
    await write("package-lock.json", "{}");
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.prerequisites).toEqual([
      {
        what: "dependencies are not installed (no node_modules directory)",
        remedy: "run `npm ci` in the workspace, then run again",
      },
    ]);
  });

  it("says a pnpm project installs with pnpm", async () => {
    await write("package.json", '{"scripts":{"test":"vitest"},"devDependencies":{"vitest":"4"}}');
    await write("pnpm-lock.yaml", "lockfileVersion: 9\n");
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.project.nodeManager).toBe("pnpm");
    expect(plan.prerequisites[0]?.remedy).toContain("pnpm install --frozen-lockfile");
  });

  it("reads a watch-mode script as interactive by declaration", async () => {
    await write("package.json", '{"scripts":{"test":"jest --watchAll"}}');
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.tests.interactive).toContain("watch mode");
  });

  it("calls a workspace with no root test script ambiguous and names the packages", async () => {
    await write("package.json", '{"workspaces":["packages/*"]}');
    await write("packages/a/package.json", '{"name":"a","scripts":{"test":"node --test"}}');
    await write("packages/b/package.json", '{"name":"b"}');
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.packages).toEqual(["packages/a", "packages/b"]);
    expect(plan.scope.kind).toBe("ambiguous");
    expect(plan.scope.detail).toContain("--package");
  });

  it("keeps a root script over a workspace at root scope and leaves the packages unmeasured", async () => {
    await write("package.json", '{"workspaces":["packages/*"],"scripts":{"test":"node --test"}}');
    await write("packages/a/package.json", '{"name":"a"}');
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.scope.kind).toBe("root");
    expect(plan.unmeasured.map((one) => one.area)).toContain("1 workspace package(s)");
  });

  it("selects named packages exactly", async () => {
    await write("package.json", '{"workspaces":["packages/*"]}');
    await write("packages/a/package.json", '{"name":"a","scripts":{"test":"node --test"}}');
    const plan = await planCheck({
      workspace: root,
      packages: ["packages/a"],
      path: await toolPath(),
    });
    expect(plan.scope).toMatchObject({ kind: "packages", selected: ["packages/a"] });
  });

  it("reads a python project with uv.lock as ready and one without an environment as not", async () => {
    await write("pyproject.toml", '[project]\nname="p"\ndependencies=["pytest"]\n');
    const bare = await planCheck({ workspace: root, path: await toolPath() });
    expect(bare.tests.runner).toBe("pytest");
    expect(bare.prerequisites[0]?.what).toContain("no project interpreter");
    await write("uv.lock", "");
    const locked = await planCheck({ workspace: root, path: await toolPath() });
    expect(locked.project.pythonCommand).toBe("uv run --locked --no-sync python -m");
    expect(locked.prerequisites).toEqual([
      {
        what: "dependencies are not installed (no .venv directory for the uv.lock)",
        remedy: "run `uv sync --locked` in the workspace, then run again",
      },
    ]);
    await write(".venv/pyvenv.cfg", "home = /usr/bin\n");
    const synced = await planCheck({ workspace: root, path: await toolPath() });
    expect(synced.prerequisites).toEqual([]);
  });

  it("reports a directory with no manifest as no scope at all", async () => {
    await write("README.md", "hello\n");
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.scope.kind).toBe("no-manifest");
    expect(plan.declaredChecks).toEqual([]);
  });

  it("names a missing toolchain rather than failing on it later", async () => {
    await write("package.json", '{"scripts":{"test":"node --test"}}');
    const plan = await planCheck({ workspace: root, path: join(root, "nowhere") });
    expect(plan.prerequisites.map((one) => one.what)).toEqual([
      "node is not on PATH",
      "npm is not on PATH",
    ]);
  });

  it("refuses to guess at a yarn or bun lockfile", async () => {
    await write("package.json", '{"scripts":{"test":"node --test"}}');
    await write("yarn.lock", "");
    const plan = await planCheck({ workspace: root, path: await toolPath() });
    expect(plan.prerequisites[0]?.what).toContain("yarn.lock");
  });
});
