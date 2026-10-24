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
 * The shape the campaign met on twenty-eight runs: a blocking gate that fails on the tree as
 * found, before the run touches anything. Through the real engine, over a real repository,
 * with the base measured by reverting the working tree and running the gate there.
 */
let scratch = "";
let workspace = "";
let evidence: EvidenceRecorder;

const passingTest = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { greet } from './greet.js';",
  "test('greets', () => { assert.equal(greet(), 'hello'); });",
  "",
].join("\n");

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-base-failure-"));
  workspace = join(scratch, "repo");
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(
    join(workspace, "src/greet.js"),
    "export function greet() {\n  return 'hello';\n}\n",
  );
  await writeFile(join(workspace, "src/greet.test.js"), passingTest);
  await writeFile(join(workspace, "package.json"), '{"scripts":{"test":"node --test"}}\n');
  const git = (...args: string[]) => run("git", args, { cwd: workspace });
  await git("init", "--quiet");
  await git("config", "user.email", "base@example.com");
  await git("config", "user.name", "base");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "seed, with a lint that already fails");
  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "base-failure",
    clock: createTestClock(),
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe("a lint that fails before the run changed anything", () => {
  const legacyLint = "node -e \"console.error('src/legacy.js:1:1 error no-var'); process.exit(1)\"";

  async function changeAndRun(requirement?: "absolute-pass" | "no-new-regression") {
    const changed = "export function greet() {\n  return 'hello';\n}\nexport const one = 1;\n";
    await writeFile(join(workspace, "src/greet.js"), changed);
    const fileSet = createFileSetRegistry(evidence);
    await fileSet.declare(["src/greet.js"], "test");
    const baseRef = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const engine = await runGatesEngine({
      workspaceRoot: workspace,
      baseRef,
      evidence,
      fileSet,
      clock: createTestClock(),
      emit: () => {},
      cap: 1,
      resolve: () => Promise.resolve(),
      gateOptions: {
        commandOverrides: {
          // Fails whatever the tree holds, which is what a pre-existing failure is.
          lint: requirement === undefined ? legacyLint : { command: legacyLint, requirement },
        },
      },
    });
    return { engine, changed };
  }

  it("is measured at the base and, held to no new regression, settles with the failure named as the base's", async () => {
    const { engine, changed } = await changeAndRun();
    expect(engine.outcome.settled).toBe("green");
    expect(engine.outcome.attempts).toHaveLength(0);
    const lint = engine.outcome.finalCycle.runs.find((one) => one.gateId === "lint");
    expect(lint).toMatchObject({
      status: "failed",
      requirement: "no-new-regression",
      inheritedOnly: true,
      inheritance: { attribution: "inherited" },
    });
    expect(engine.outcome.finalCycle.blockingFailures).toEqual([]);
    const baseline = evidence.records().find((record) => record.type === "gate-baseline");
    expect(evidence.payloads().get(baseline?.payloadDigest ?? "")).toMatchObject({
      gateId: "lint",
      status: "failed",
    });
    // The gate-run record names the base record it was read against.
    const record = evidence.payloads().get(lint?.record ?? "") as {
      inheritance?: { baselineRecord?: string };
    };
    expect(record.inheritance?.baselineRecord).toBe(baseline?.payloadDigest);
    // The swap to the base tree and back left the run's change where it was.
    expect(await readFile(join(workspace, "src/greet.js"), "utf8")).toBe(changed);
  }, 60_000);

  it("still blocks where the gate must pass outright, and the escalation names it as the base's", async () => {
    const { engine } = await changeAndRun("absolute-pass");
    expect(engine.outcome.settled).toBe("escalated");
    expect(engine.outcome.escalation?.gateId).toBe("lint");
    expect(engine.outcome.escalation?.failingAtBase).toEqual(["lint"]);
    expect(engine.outcome.escalation?.reason).toContain("fails the same way at the base commit");
  }, 60_000);
});
