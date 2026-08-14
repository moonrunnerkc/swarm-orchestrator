import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentTaskOptions, runAgentTask } from "./agent-run.ts";
import type { Clock } from "./core/clock.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";

const run = promisify(execFile);
const clock: Clock = { now: () => 1_700_000_000_000, sleep: () => Promise.resolve() };

let scratch = "";
let workspace = "";
let evidence: EvidenceRecorder;

async function git(...args: string[]): Promise<void> {
  await run("git", args, { cwd: workspace });
}

async function write(path: string, contents: string): Promise<void> {
  await mkdir(join(workspace, path, ".."), { recursive: true });
  await writeFile(join(workspace, path), contents, "utf8");
}

const suite = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { greet } from './greet.js';",
  "",
  "test('greets', () => { assert.equal(greet(), 'hello'); });",
  "",
].join("\n");

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-agent-run-"));
  workspace = join(scratch, "repo");
  await mkdir(workspace, { recursive: true });
  await write("src/greet.js", "export function greet() {\n  return 'hello';\n}\n");
  await write("src/greet.test.js", suite);
  await git("init", "--quiet");
  await git("config", "user.email", "agent@example.com");
  await git("config", "user.name", "agent");
  await git("add", ".");
  await git("commit", "--quiet", "-m", "seed");

  evidence = await openEvidenceSession({
    root: join(scratch, "sessions"),
    sessionId: "agent-session",
    clock,
  });
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const gateOverrides = {
  tests: "node --test --test-reporter=tap",
  lint: "node --check src/greet.js",
  typecheck: "node --check src/greet.js",
  format: "node --check src/greet.test.js",
};

function task(turns: readonly FixtureTurn[], overrides: Partial<AgentTaskOptions> = {}) {
  const model = createRecordingModelClient(
    createFixtureModelClient({ modelId: "fixture:worker", turns }),
    evidence,
  );
  return runAgentTask({
    task: "add a shout helper",
    workspace,
    baseRef: "HEAD",
    maxSteps: 8,
    attempts: 0,
    model,
    evidence,
    fileSet: createFileSetRegistry(evidence),
    clock,
    random: createFixedRandom(),
    emit: () => {},
    confirm: () => Promise.resolve(false),
    abortSignal: new AbortController().signal,
    homeDir: scratch,
    gateOptions: { commandOverrides: gateOverrides },
    ...overrides,
  });
}

/** Declares its file set, writes the change, and stops. What an ordinary run looks like. */
function goodTurns(contents: string): readonly FixtureTurn[] {
  return [
    respondWithToolCalls("declaring", [
      {
        callId: "c0",
        toolName: "declare_file_set",
        input: { files: ["src/greet.js"] },
      },
    ]),
    respondWithToolCalls("writing", [
      { callId: "c1", toolName: "write", input: { path: "src/greet.js", content: contents } },
    ]),
    respondWithText("done"),
  ];
}

const stillGreen = "export function greet() {\n  return 'hello';\n}\nexport const shout = 1;\n";
const broken = "export function greet() {\n  return 'goodbye';\n}\n";

describe("runAgentTask", () => {
  it("runs the loop and then the gates, and calls it green when both are", async () => {
    const result = await task(goodTurns(stillGreen));

    expect(result.loop.stopReason).toBe("completed");
    expect(result.gates.outcome.settled).toBe("green");
    expect(result.green).toBe(true);
  });

  it("is not green when the change the model made fails a gate", async () => {
    const result = await task(goodTurns(broken));

    expect(result.green).toBe(false);
    expect(result.gates.outcome.finalCycle.blockingFailures.map((gate) => gate.gateId)).toContain(
      "tests",
    );
  });

  it("records the session opening and closing on the chain it was given", async () => {
    await task(goodTurns(stillGreen));

    const types = evidence.records().map((entry) => entry.type);
    expect(types[0]).toBe("session-started");
    expect(types).toContain("session-stopped");
    expect(types).toContain("gate-run");
  });

  it("gives the model the workspace tools and the file-set tools together", async () => {
    const result = await task(goodTurns(stillGreen));

    const fileSet = result.gates.outcome.finalCycle.runs.find((gate) => gate.gateId === "file-set");
    expect(fileSet?.status).toBe("passed");
  });

  it("measures the change against a configured diff budget instead of the built-in one", async () => {
    const result = await task(goodTurns(stillGreen), {
      diffBudget: { maxChangedFiles: 12, maxAddedLines: 0 },
    });

    const budget = result.gates.outcome.finalCycle.runs.find(
      (gate) => gate.gateId === "diff-budget",
    );
    expect(budget?.detail).toMatch(/over budget/);
    expect(budget?.detail).toMatch(/against 0/);
  });

  it("leaves the model's completion narrative recorded as narrative, never as a result", async () => {
    const result = await task(goodTurns(broken));

    expect(result.loop.completionClaim).toBe("done");
    expect(result.green).toBe(false);
  });
});
