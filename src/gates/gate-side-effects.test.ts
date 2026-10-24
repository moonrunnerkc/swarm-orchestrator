import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { type EvidenceRecorder, openEvidenceSession } from "../evidence/session.ts";
import { runGatesEngine } from "./engine.ts";
import { createFileSetRegistry } from "./file-set.ts";

const run = promisify(execFile);

/**
 * A check that writes into the workspace, as ufo's build does when automd regenerates README.md,
 * through the real engine over a real repository. Its write is put back after every run, so it
 * never becomes part of the change the repair is judged on.
 */
let scratch = "";
let workspace = "";
let evidence: EvidenceRecorder;

const failingTest = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { double } from './double.js';",
  "test('doubles', () => { assert.equal(double(2), 4); });",
  "",
].join("\n");

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-side-effects-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, "double.js"), "export const double = (n) => n;\n");
  await writeFile(join(workspace, "double.test.js"), failingTest);
  await writeFile(join(workspace, "README.md"), "# double\n");
  await writeFile(
    join(workspace, "package.json"),
    '{"type":"module","scripts":{"test":"node --test"}}\n',
  );
  const git = (...args: string[]) => run("git", args, { cwd: workspace });
  await git("init", "--quiet");
  await git("config", "user.email", "t@example.com");
  await git("config", "user.name", "t");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "base");
  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "side-effects",
    clock: createTestClock(),
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("a check that writes into the workspace", () => {
  it("has its write put back and named, so a repair is judged on its own change", async () => {
    const fileSet = createFileSetRegistry(evidence);
    await fileSet.declare(["double.js"], "test");
    const baseRef = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const engine = await runGatesEngine({
      workspaceRoot: workspace,
      baseRef,
      evidence,
      fileSet,
      clock: createTestClock(),
      emit: () => {},
      cap: 1,
      resolve: () =>
        writeFile(join(workspace, "double.js"), "export const double = (n) => n * 2;\n"),
      gateOptions: {
        commandOverrides: {
          // Regenerates documentation on every run, as automd does.
          build: `node -e "require('fs').appendFileSync('README.md', 'generated at ' + Date.now() + '\\n')"`,
        },
      },
    });
    expect(engine.outcome.attempts[0]?.decision.accepted).toBe(true);
    expect(engine.outcome.settled).toBe("green");
    expect(engine.outcome.finalCycle.statuses["file-set"]).toBe("passed");
    expect(await readFile(join(workspace, "README.md"), "utf8")).toBe("# double\n");
    const build = engine.outcome.finalCycle.runs.find((one) => one.gateId === "build");
    expect(evidence.payloads().get(build?.record ?? "")).toMatchObject({
      workspaceWrites: ["README.md"],
    });
  }, 60_000);
});
