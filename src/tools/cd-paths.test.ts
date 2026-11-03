import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openEvidenceSession } from "../evidence/session.ts";
import { type Chokepoint, createChokepoint } from "./chokepoint.ts";
import { createPolicyGuard } from "./policy-guard.ts";

/**
 * A relative path after a `cd` names a file under the directory the `cd` moved to. The four path
 * refusals of this kind in the 2026-11-01 acceptance sessions, verbatim from their ledgers, each
 * refused as "resolves outside the workspace" though the path named the workspace's own file.
 */
const recorded = [
  {
    at: "20261101T053630-ed48ab record 37",
    command:
      "cd packages/narrative && npx vitest run test/render.test.ts --config ../../vitest.config.ts 2>&1 | tail -30",
  },
  ...[11, 14, 17].map((sequence) => ({
    at: `20261101T144722-d7f096 record ${sequence}`,
    command:
      'cd src/tracemantle && grep -rn "history_io\\|history_store" --include="*.py" . | grep -v "core/history_io.py\\|history_store.py"; echo ---; grep -rn "from tracemantle.core.history_io\\|from tracemantle.history_store\\|import history_store\\|import history_io" ../../tests ../../src ../../scripts ../../docs 2>/dev/null',
  })),
];

let root = "";
let run: (approval: "ask" | "auto") => Chokepoint;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "cd-paths-")));
  const workspace = join(root, "repo");
  for (const directory of [
    "packages/narrative/test",
    "src/tracemantle/core",
    "tests",
    "scripts",
    "docs",
    ".git",
    "src/lib",
  ]) {
    await mkdir(join(workspace, directory), { recursive: true });
  }
  await writeFile(join(workspace, "vitest.config.ts"), "export default {};\n");
  await writeFile(join(workspace, "package.json"), '{"name":"the-workspace"}\n');
  await writeFile(join(workspace, "src", "package.json"), '{"name":"src"}\n');
  await writeFile(join(workspace, ".git", "config"), "[core]\n");
  await writeFile(join(workspace, "src/tracemantle/core/history_io.py"), "import history_io\n");
  await writeFile(
    join(workspace, "tests/test_io.py"),
    "from tracemantle.core.history_io import x\n",
  );
  await writeFile(join(root, "outside.txt"), "outside\n");
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: "s",
    now: () => 1,
  });
  // npx and tail are off this list: with nobody to ask they are declined after the path check,
  // which shows the paths got through without running a test runner.
  const guard = createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: homedir(),
    shellAllowlist: ["cat", "cd", "echo", "grep", "ls", "true"],
    deniedRoots: [join(root, "sessions")],
    childHomeDir: join(root, "child-home"),
  });
  run = (approval) =>
    createChokepoint({ guard, evidence, approval, confirm: null, timeoutMs: 30_000 });
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const pathRefusal = /resolves outside the workspace|denied path|credential denylist/;

describe("the path refusals of 2026-11-01 on a relative path after cd", () => {
  it.each(recorded)("checks $at from the directory the cd moved to", async ({ command }) => {
    const outcome = await run("ask").run(command);
    expect(outcome.output).not.toMatch(pathRefusal);
  });

  it("runs the tracemantle command and finds the workspace's own tests", async () => {
    const outcome = await run("ask").run(recorded[1]?.command ?? "");
    expect(outcome).toMatchObject({ decision: "allowed" });
    expect(outcome.output).toContain("../../tests/test_io.py:1:from tracemantle.core.history_io");
  });
});

describe("paths after cd, as the shell reads them", () => {
  it("reads a relative path from the cd's directory, as the shell does", async () => {
    const outcome = await run("auto").run("cd src && cat ../package.json package.json");
    expect(outcome).toMatchObject({ decision: "allowed", exitCode: 0 });
    expect(outcome.output).toBe('{"name":"the-workspace"}\n{"name":"src"}\n');
  });

  it("refuses a credential file reached through a cd, which the root-relative reading allowed", async () => {
    const outcome = await run("auto").run("cd .git && cat config");
    expect(outcome.decision).toBe("denied");
    expect(outcome.output).toContain(".git/config matches the credential denylist");
  });

  it("follows cd after cd, and refuses a climb out of the workspace from below", async () => {
    expect((await run("auto").run("cd src && cd lib && cat ../../package.json")).decision).toBe(
      "allowed",
    );
    const out = await run("auto").run("cd src && cat ../../outside.txt");
    expect(out.decision).toBe("denied");
    expect(out.output).toMatch(/outside\.txt resolves outside the workspace/);
  });

  it("after ; or ||, checks a path from every directory the shell may be in", async () => {
    // The cd that comes first and names a directory that exists cannot fail.
    expect((await run("auto").run("cd src; cat ../package.json")).decision).toBe("allowed");
    // One that may not run, or may fail, leaves both directories possible.
    for (const command of [
      "cd missing; cat ../package.json",
      "true && cd src; cat ../package.json",
      "cd missing || true; cat ../package.json",
      "cat package.json && cd src || cat ../package.json",
    ]) {
      const outcome = await run("auto").run(command);
      expect(outcome.decision, command).toBe("denied");
      expect(outcome.output, command).toMatch(/resolves outside the workspace/);
    }
  });

  it("leaves the directory unchanged by a cd inside a pipe, which runs in a subshell", async () => {
    const outcome = await run("auto").run("cd src | cat ../package.json");
    expect(outcome.decision).toBe("denied");
    expect(outcome.output).toMatch(/resolves outside the workspace/);
  });

  it("refuses in auto mode a cd whose destination it cannot read", async () => {
    for (const command of ["cd - && cat package.json", "popd && cat package.json", "cd a b"]) {
      const outcome = await run("auto").run(command);
      expect(outcome.decision, command).toBe("denied");
      expect(outcome.output, command).toContain("cannot be read");
    }
  });
});
