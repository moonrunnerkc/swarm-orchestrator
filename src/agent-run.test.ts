import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentTaskOptions, runAgentTask, systemPrompt } from "./agent-run.ts";
import type { Clock } from "./core/clock.ts";
import type { ModelClient, ModelRequest } from "./core/model-client.ts";
import { createFixedRandom } from "./core/test-doubles.ts";
import type { JsonValue } from "./evidence/canonical-json.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondTruncated,
  respondWithText,
  respondWithToolCalls,
} from "./providers/fixture-provider.ts";
import { createReadTrailTool } from "./workers/trail-tool.ts";

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

  it("is green when the gates are, even where the model stopped short of saying so", async () => {
    // The auto-resolve exists to carry a run to green that the model did not finish itself.
    // Reading its stop reason as a second condition let the model's account of itself overrule
    // what every gate measured, so a tree that passed every gate reported failure to CI.
    const turns = goodTurns(stillGreen).slice(0, -1);
    const result = await task([
      ...turns,
      respondTruncated(),
      respondTruncated(),
      respondTruncated(),
    ]);

    expect(result.loop.stopReason).toBe("output-cap");
    expect(result.gates.outcome.settled).toBe("green");
    expect(result.green).toBe(true);
  });

  it("is not green when it died before it changed anything", async () => {
    // Gates over a tree nothing touched pass the way an empty diff has no bugs. A run that
    // failed at step 17 having written nothing reported success, while the reward log beside
    // it said "nothing was done and there is nothing to reward" about the same run.
    const result = await task([]);

    expect(result.loop.stopReason).not.toBe("completed");
    expect(result.gates.outcome.finalCycle.measures.changedFiles ?? 0).toBe(0);
    expect(result.green).toBe(false);
  });

  it("is not green when nothing ran over the code it changed", async () => {
    // A run wrote 142 lines of Python into a directory with no manifest, so typecheck, lint,
    // format and tests were all not-applicable, and it reported green over a file that could
    // not even be imported. Nothing had tried. Not measured is not a pass.
    const result = await task(goodTurns(stillGreen), {
      gateOptions: { commandOverrides: {} },
    });

    const ranACommand = result.gates.gates.some(
      (gate) =>
        gate.source.kind === "command" &&
        result.gates.outcome.finalCycle.statuses[gate.id] !== "not-applicable",
    );

    expect(ranACommand).toBe(false);
    expect(result.gates.outcome.finalCycle.measures.changedFiles ?? 0).toBeGreaterThan(0);
    expect(result.green).toBe(false);
  });

  it("is not green when somebody cancelled it, whatever the gates last saw", async () => {
    const result = await task(goodTurns(stillGreen), { abortSignal: AbortSignal.abort() });

    expect(result.loop.stopReason).toBe("interrupted");
    expect(result.green).toBe(false);
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

  it("runs a declaration whose array argument the model encoded as a JSON string", async () => {
    // What qwen3-coder emits intermittently through an OpenAI-compatible endpoint. Denying it
    // costs the whole run: the declaration never lands, the edit happens anyway, and the
    // file-set gate can no longer pass, because nothing declared the file before it changed.
    const turns: readonly FixtureTurn[] = [
      respondWithToolCalls("declaring", [
        {
          callId: "c0",
          toolName: "declare_file_set",
          input: { files: '["src/greet.js"]' },
        },
      ]),
      respondWithToolCalls("writing", [
        { callId: "c1", toolName: "write", input: { path: "src/greet.js", content: stillGreen } },
      ]),
      respondWithText("done"),
    ];

    const result = await task(turns);

    const fileSet = result.gates.outcome.finalCycle.runs.find((gate) => gate.gateId === "file-set");
    expect(fileSet?.status).toBe("passed");
    expect(result.green).toBe(true);
    expect(evidence.records().map((entry) => entry.type)).toContain("file-set-declared");
  });

  it("records the encoding the model sent beside the fields the harness decoded", async () => {
    const turns: readonly FixtureTurn[] = [
      respondWithToolCalls("declaring", [
        { callId: "c0", toolName: "declare_file_set", input: { files: '["src/greet.js"]' } },
      ]),
      respondWithText("done"),
    ];

    await task(turns);

    const payloads = evidence.payloads();
    const declarations: Readonly<Record<string, JsonValue>>[] = [];
    for (const entry of evidence.records()) {
      if (entry.type !== "tool-call") {
        continue;
      }
      // A tool-call payload is an object by construction, which is what the recorder writes.
      const payload = payloads.get(entry.payloadDigest) as
        | Readonly<Record<string, JsonValue>>
        | undefined;
      if (payload?.toolName === "declare_file_set") {
        declarations.push(payload);
      }
    }

    expect(declarations.length).toBeGreaterThan(0);
    for (const payload of declarations) {
      expect(payload.input).toEqual({ files: '["src/greet.js"]' });
      expect(payload.decodedFields).toEqual(["files"]);
    }
  });

  it("leaves the model's completion narrative recorded as narrative, never as a result", async () => {
    const result = await task(goodTurns(broken));

    expect(result.loop.completionClaim).toBe("done");
    expect(result.green).toBe(false);
  });
});

describe("the trail tool a worker is given and the single-agent path is not", () => {
  function spyOn(turns: readonly FixtureTurn[]) {
    const requests: ModelRequest[] = [];
    const fixture = createFixtureModelClient({ modelId: "fixture:worker", turns });
    const model: ModelClient = {
      modelId: fixture.modelId,
      generate: (request) => {
        requests.push(request);
        return fixture.generate(request);
      },
    };
    return { requests, model };
  }

  const stopAtOnce = [respondWithText("nothing to do")];

  it("offers exactly today's tools when no trail is passed", async () => {
    const spy = spyOn(stopAtOnce);

    await task(stopAtOnce, { model: spy.model });

    expect(spy.requests[0]?.tools.map((tool) => tool.name)).toEqual([
      "read",
      "write",
      "edit",
      "list",
      "search",
      "shell",
      "claim",
      "declare_file_set",
      "amend_file_set",
    ]);
  });

  it("sends the system prompt byte for byte when no trail is passed", async () => {
    const spy = spyOn(stopAtOnce);

    await task(stopAtOnce, { model: spy.model });

    expect(spy.requests[0]?.system).toBe(systemPrompt);
  });

  it("adds the trail tool and nothing else when one is passed", async () => {
    const spy = spyOn(stopAtOnce);
    const trail = createReadTrailTool({ peers: () => [] });

    await task(stopAtOnce, { model: spy.model, trail });

    const names = spy.requests[0]?.tools.map((tool) => tool.name) ?? [];
    expect(names).toContain("read_trail");
    expect(names).toHaveLength(10);
  });

  it("sends no sampling settings when none are asked for", async () => {
    const spy = spyOn(stopAtOnce);

    await task(stopAtOnce, { model: spy.model });

    expect(spy.requests[0]?.sampling).toBeUndefined();
  });

  it("carries the sampling settings an attempt was given through to the model", async () => {
    const spy = spyOn(stopAtOnce);
    const sampling = { temperature: 0.7, topP: 0.95, seed: 12345 };

    await task(stopAtOnce, { model: spy.model, sampling });

    expect(spy.requests[0]?.sampling).toEqual(sampling);
  });

  it("says the trail is a peer's account rather than a result, and quotes no peer", async () => {
    const spy = spyOn(stopAtOnce);
    const trail = createReadTrailTool({ peers: () => [] });

    await task(stopAtOnce, { model: spy.model, trail });

    const added = (spy.requests[0]?.system ?? "").slice(systemPrompt.length);
    expect(added).toContain("read_trail");
    expect(added).not.toMatch(/verified|green|\bpassed\b/i);
  });
});
