import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentTaskOptions, runAgentTask, systemPrompt } from "./agent-run.ts";
import { createSystemClock } from "./cli-runtime-inputs.ts";
import { taskGoalGate } from "./cli-task-goal.ts";
import type { Clock } from "./core/clock.ts";
import type { ModelClient, ModelRequest } from "./core/model-client.ts";
import { createFixedRandom, createTestClock } from "./core/test-doubles.ts";
import { buildAttestation, signAttestation } from "./evidence/attestation.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import { asJsonValue, digestOfBytes, type JsonValue } from "./evidence/canonical-json.ts";
import { declareGoalContract } from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { recordGoalAssessment } from "./evidence/run-assessment.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import { createEphemeralSigningKey } from "./evidence/signing.ts";
import { parseTaskContract } from "./evidence/task-contract.ts";
import { harnessChildEnvironment } from "./exec/child-environment.ts";
import { createFileSetRegistry } from "./gates/file-set.ts";
import { verifyIndependently } from "./gates/independent-verification.ts";
import { createNodeCommandRunner } from "./gates/node-command-runner.ts";
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
    confirm: () => Promise.resolve("no"),
    abortSignal: new AbortController().signal,
    homeDir: scratch,
    gateOptions: { commandOverrides: gateOverrides },
    ...overrides,
  });
}

/** Declares its file set, writes the change, and stops. What an ordinary run looks like. */
describe("the approval mode reaches the chokepoint", () => {
  it("pre-approves a shell-allowlist prompt under auto, and the record says who decided", async () => {
    await task(
      [
        respondWithToolCalls("checking", [
          { callId: "s", toolName: "shell", input: { command: "true" } },
        ]),
        respondWithText("done"),
      ],
      { approvalMode: "auto" },
    );

    const confirmation = evidence.records().find((record) => record.type === "confirmation");
    const payload = evidence.payloads().get(confirmation?.payloadDigest ?? "");
    expect(payload).toMatchObject({
      reason: "shell-allowlist",
      outcome: "pre-approved",
      decidedBy: "approval-mode",
    });
  });
});

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

  it("is not green when the only command gate found nothing to run", async () => {
    // The gate strip showed no failure, so a second reading of it said green while the run's
    // own verdict said otherwise, and the exit code followed the wrong one. A run wrote three
    // files into a workspace whose test command collected nothing and exited 0.
    const result = await task(goodTurns(stillGreen), {
      gateOptions: {
        commandOverrides: {
          tests: "node -e \"console.log('TAP version 13'); console.log('# tests 0')\"",
        },
      },
    });

    expect(result.gates.outcome.finalCycle.statuses.tests).toBe("not-applicable");
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
      "read_recorded_output",
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
    expect(names).toHaveLength(11);
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

describe("the run's wall budget", () => {
  /** Declares, writes the broken change, then never answers again until aborted. */
  function writesThenHangs(onHang: () => void): ModelClient {
    const scripted = createFixtureModelClient({
      modelId: "fixture:hangs",
      turns: [
        respondWithToolCalls("declaring", [
          { callId: "c0", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
        ]),
        respondWithToolCalls("writing", [
          { callId: "c1", toolName: "write", input: { path: "src/greet.js", content: broken } },
        ]),
      ],
    });
    let calls = 0;
    return {
      modelId: "fixture:hangs",
      generate(request: ModelRequest) {
        calls += 1;
        if (calls <= 2) {
          return scripted.generate(request);
        }
        return new Promise((_, reject) => {
          request.abortSignal.addEventListener(
            "abort",
            () => reject(new Error("aborted at the wall")),
            {
              once: true,
            },
          );
          onHang();
        });
      },
    };
  }

  it("ends a hung loop at the budget, runs the gates, spends no attempt, and still writes the bundle's records", async () => {
    const ticking = createTestClock(1_700_000_000_000);
    const budgetMs = 5 * 60_000;
    const model = createRecordingModelClient(
      writesThenHangs(() => ticking.advance(budgetMs)),
      evidence,
    );

    const outcome = await task([], { model, clock: ticking, attempts: 2, maxWallTimeMs: budgetMs });

    expect(outcome.loop.stopReason).toBe("max-wall-time");
    expect(outcome.green).toBe(false);
    expect(outcome.gates.outcome.settled).not.toBe("green");
    expect(outcome.gates.outcome.attempts).toHaveLength(0);
    const records = evidence.records();
    const budget = records.find((record) => record.type === "session-budget");
    expect(evidence.payloads().get(budget?.payloadDigest ?? "")).toMatchObject({
      maxWallTimeMs: budgetMs,
    });
    expect(records.some((record) => record.type === "escalation")).toBe(true);
  });

  it("leaves a run without one exactly as it was: each loop its own half hour, no bound over the whole", async () => {
    const outcome = await task(goodTurns(stillGreen));

    expect(outcome.green).toBe(true);
    const records = evidence.records();
    expect(
      records
        .filter((record) => record.type === "session-budget")
        .map((record) => evidence.payloads().get(record?.payloadDigest ?? "")),
    ).toEqual([expect.objectContaining({ phase: "settled", tokensUsed: outcome.loop.tokensUsed })]);
  });
});

it("records real tool intents and completions in durable state", async () => {
  const { openRunStore } = await import("./durable/run-store.ts");
  const path = join(scratch, "runs.jsonl");
  const completed = await task(goodTurns(stillGreen), { runStorePath: path });
  const store = openRunStore(path);
  expect(
    store.steps(evidence.sessionId).some((step) => step.kind === "write" && step.state === "done"),
  ).toBe(true);
  expect(store.run(evidence.sessionId)?.state).toBe(
    completed.verdict.acceptable ? "finished" : "aborted",
  );
});

it("keeps a test deletion refused in the returned and recorded assessment", async () => {
  const deleted = await task([
    respondWithToolCalls("declare", [
      { callId: "declare", toolName: "declare_file_set", input: { files: ["src/greet.test.js"] } },
    ]),
    respondWithToolCalls("delete a test", [
      {
        callId: "edit",
        toolName: "write",
        input: { path: "src/greet.test.js", content: "import { test } from 'node:test';\n" },
      },
    ]),
    respondWithText("done"),
  ]);
  expect(deleted.gates.outcome.baseComparison.decision.accepted).toBe(false);
  expect(deleted.green).toBe(false);
  expect(deleted.verdict.acceptable).toBe(false);
  const recorded = evidence.records().findLast((entry) => entry.type === "run-assessment");
  expect(evidence.payloads().get(recorded?.payloadDigest ?? "")).toMatchObject({
    verdict: { acceptable: false },
  });
});

it("records repair feedback as tool output and applies the execution derivation heuristic to it", async () => {
  const injected =
    "node -e \"require('node:fs').writeFileSync('should-not-exist.txt','modified')\"";
  await task(
    [
      respondWithToolCalls("follow diagnostic", [
        { callId: "injected", toolName: "shell", input: { command: injected } },
      ]),
      respondWithText("done"),
    ],
    { repairFeedback: `The runner printed this suggestion: ${injected}` },
  );
  await expect(access(join(workspace, "should-not-exist.txt"))).rejects.toThrow();
  const call = evidence
    .records()
    .filter((record) => record.type === "tool-call")
    .map((record) => evidence.payloads().get(record.payloadDigest))
    .find(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        "callId" in payload &&
        payload.callId === "injected" &&
        "decision" in payload &&
        payload.decision === "denied",
    );
  expect(call).toMatchObject({
    derivation: { matched: true, source: { tag: "tool-output", label: "recorded repair context" } },
  });
  expect(
    evidence.records().find((record) => record.type === "session-started")?.provenance,
  ).toContain("tool-output");
});

it("dispatches one explicit alternate after repeated observed failure and stops at its cap", async () => {
  const alternate = createRecordingModelClient(
    createFixtureModelClient({
      modelId: "fixture:alternate",
      turns: [respondWithText("No repair found.")],
    }),
    evidence,
  );
  const result = await task(
    [
      respondWithToolCalls("declare", [
        { callId: "declare", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
      ]),
      respondWithToolCalls("change", [
        {
          callId: "break",
          toolName: "write",
          input: { path: "src/greet.js", content: "export function greet() { return 'wrong'; }\n" },
        },
      ]),
      respondWithText("done"),
      respondWithText("No repair found."),
    ],
    {
      attempts: 4,
      maxTokens: 50000,
      clock: createSystemClock(),
      maxWallTimeMs: 60000,
      escalation: {
        settings: {
          target: "fixture:alternate",
          trigger: "repeated-failure",
          maximum: 1,
          reservedTokens: 1024,
          reserveMs: 1000,
        },
        target: alternate,
      },
    },
  );
  const entries = evidence
    .records()
    .map((record) => evidence.payloads().get(record.payloadDigest))
    .filter(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Reflect.get(value, "rule") === "capability-escalation-v1",
    );
  expect(
    entries,
    JSON.stringify({
      outcome: result.gates.outcome,
      stops: evidence
        .records()
        .filter((record) => record.type === "session-stopped")
        .map((record) => evidence.payloads().get(record.payloadDigest)),
    }),
  ).toHaveLength(2);
  expect(entries).toMatchObject([
    { phase: "intent", count: 1, effectiveModel: "fixture:alternate" },
    { phase: "completed", count: 1, unknownUsage: false },
  ]);
  expect(
    evidence
      .records()
      .filter((record) => record.type === "model-call" && record.actor === "fixture:alternate"),
  ).toHaveLength(1);
  const alternateCall = evidence
    .records()
    .find((record) => record.type === "model-call" && record.actor === "fixture:alternate");
  const prompt = JSON.stringify(evidence.payloads().get(alternateCall?.payloadDigest ?? ""));
  expect(prompt).toContain("Your current change against it is recorded as sha256:");
  // The change itself, so a repair can tell the candidate's lines from the base's own.
  expect(prompt).toContain("That change, as a diff against the base");
  expect(prompt).toContain("+export function greet() { return 'wrong'; }");
  expect(prompt).not.toContain("Candidate patch:");
  expect(prompt).toContain("Remaining model allowance:");
  expect(prompt).toContain("The workspace is in the state gate cycle");
  expect(result.green).toBe(false);
}, 30000);

it.each(["hello", "wrong"])(
  "binds final goal %s to the recorded worker verdict and attestation",
  async (expected) => {
    const baseCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
    const contract = await declareGoalContract(evidence, {
      version: 1,
      goal: "Preserve greeting",
      requirements: [
        { id: "greeting", description: "The greeting is checked", checks: ["greeting"] },
      ],
      checks: [
        {
          id: "greeting",
          command: "pinned greeting",
          author: "user",
          exposure: "withheld",
          artifacts: [],
          behavior: {
            kind: "cli",
            cwd: ".",
            timeoutMs: 3000,
            maxOutputBytes: 4000,
            toolchain: "node",
            network: "inherit",
            argv: [
              "node",
              "--input-type=module",
              "-e",
              "import {greet} from './src/greet.js';console.log(greet())",
            ],
            stdin: "",
            exitCode: 0,
            stdout: [{ kind: "equals", value: `${expected}\n` }],
            stderr: [],
          },
        },
      ],
      immutablePaths: ["src/greet.test.js"],
    });
    const worker = await task([respondWithText("done")], { baseRef: baseCommit });
    const independent = await verifyIndependently({
      repositoryRoot: workspace,
      baseCommit,
      patch: "",
      clock,
      commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
      gateOptions: { commandOverrides: gateOverrides },
      goal: { contract, evidence, tree: "" },
    });
    const observed = await evidence.record({
      type: "independent-verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        ...independent,
        sourcePatchDigest: digestOfBytes(""),
        sourceBase: baseCommit,
      }),
    });
    const verdict = await recordGoalAssessment(evidence, observed.record.payloadDigest);
    expect(verdict.acceptable).toBe(worker.green && expected === "hello");
    expect(verdict.task).toBe(expected === "hello" ? "accepted" : "rejected");
    const key = createEphemeralSigningKey();
    const spec = evidence.records().find((record) => record.type === "run-spec-sealed");
    if (!spec) throw Error("missing run seal");
    const attestation = signAttestation(
      buildAttestation({
        runId: evidence.sessionId,
        specDigest: spec.payloadDigest,
        sourceCommit: baseCommit,
        patchDigest: digestOfBytes(""),
        chainHead: evidence.head().hash,
        toolVersion: "test",
        executionMode: verdict.executionTrust,
        verdict: { ...verdict },
      }),
      key,
    );
    const destination = join(scratch, "goal-bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination,
      signingKey: key,
      clock,
      attestation,
    });
    const verified = await run(process.execPath, [join(destination, "verify.mjs"), destination]);
    expect(verified.stdout).toContain("bundle verified");
    expect(verified.stdout).toContain("attestation bound to this bundle");
  },
  30000,
);

it("repairs failed pinned behavior through the existing loop even when regression passes", async () => {
  await write("package.json", JSON.stringify({ type: "module", scripts: { test: "node --test" } }));
  await git("add", "package.json");
  await git("commit", "-qm", "declare native test runner");
  const baseCommit = (await run("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
  const contract = await declareGoalContract(evidence, {
    version: 1,
    goal: "Expose shout as one",
    requirements: [{ id: "shout", description: "shout is one", checks: ["shout"] }],
    checks: [
      {
        id: "shout",
        command: "pinned output",
        author: "user",
        exposure: "withheld",
        artifacts: [],
        behavior: {
          kind: "cli",
          cwd: ".",
          timeoutMs: 3000,
          maxOutputBytes: 4000,
          toolchain: "Node",
          network: "inherit",
          argv: [
            "node",
            "--input-type=module",
            "-e",
            "import * as m from './src/greet.js';console.log(m.shout)",
          ],
          exitCode: 0,
          stdout: [{ kind: "equals", value: "1\n" }],
          stderr: [],
        },
      },
    ],
    immutablePaths: ["src/greet.test.js"],
  });
  const result = await task([respondWithText("done"), ...goodTurns(stillGreen)], {
    attempts: 1,
    baseRef: baseCommit,
    gateOptions: {
      commandOverrides: gateOverrides,
      acceptanceGate: taskGoalGate({
        contract,
        workspace,
        baseCommit,
        evidence,
        clock,
        signal: new AbortController().signal,
        isolation: null,
        install: false,
      }),
    },
  });
  expect(result.gates.outcome.firstCycle.statuses.tests).toBe("passed");
  expect(result.gates.outcome.firstCycle.statuses["task-acceptance"]).toBe("failed");
  expect(result.gates.outcome.attempts).toHaveLength(1);
  expect(result.gates.outcome.finalCycle.statuses["task-acceptance"]).toBe("passed");
  expect(result.green).toBe(true);
}, 60000);

describe("a worker that repeats one inspection", () => {
  it("is told once, stopped the second time, and both decisions are on the chain and in the assessment", async () => {
    const inspection = (callId: string) =>
      respondWithToolCalls("checking the manifest", [
        { callId, toolName: "read", input: { path: "src/greet.js" } },
      ]);
    const result = await task(
      Array.from({ length: 12 }, (_, index) => inspection(`look-${index}`)),
      { maxSteps: 20 },
    );

    expect(result.loop.stopReason).toBe("stalled");
    expect(result.loop.steps).toBe(7);
    // The tree is unchanged, so the gates measured nothing and the run is not acceptable.
    expect(result.green).toBe(false);
    const decisions = evidence
      .records()
      .filter((record) => record.type === "session-budget")
      .map((record) => evidence.payloads().get(record.payloadDigest) as { rule?: string })
      .filter((payload) => payload.rule === "tool-stall-v1");
    expect(decisions).toEqual([
      expect.objectContaining({ intervention: "feedback", toolName: "read", repeats: 3, step: 4 }),
      expect.objectContaining({ intervention: "stop", toolName: "read", repeats: 3, step: 7 }),
    ]);
    const assessment = evidence.records().findLast((record) => record.type === "run-assessment");
    expect(evidence.payloads().get(assessment?.payloadDigest ?? "")).toMatchObject({
      inputs: { lifecycle: "stalled" },
      verdict: { acceptable: false },
    });
    // The notice reached the model as a conversation message the next call carried.
    const prompts = evidence
      .records()
      .filter((record) => record.type === "model-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)));
    expect(prompts.at(-1)).toContain("repeated tool calls");
    expect(prompts[3]).not.toContain("repeated tool calls");
  });
});

describe("what a repair attempt is handed about the loop before it", () => {
  it("carries the previous loop's account and holds the measured gate time back from its wall", async () => {
    const result = await task(
      [
        respondWithToolCalls("declaring", [
          { callId: "c0", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
        ]),
        respondWithToolCalls("looking", [
          { callId: "c1", toolName: "search", input: { pattern: "emitWsNeeded", path: "src" } },
        ]),
        respondWithToolCalls("writing", [
          { callId: "c2", toolName: "write", input: { path: "src/greet.js", content: broken } },
        ]),
        respondWithText("done"),
        respondWithText("No repair found."),
      ],
      // A real clock, so the gates' measured durations are what the reserve is read from.
      { attempts: 1, clock: createSystemClock() },
    );

    expect(result.green).toBe(false);
    expect(result.gates.outcome.attempts).toHaveLength(1);
    const repairs = evidence
      .records()
      .filter((record) => record.type === "session-stopped")
      .map((record) => evidence.payloads().get(record.payloadDigest) as Record<string, unknown>)
      .filter((payload) => payload.repair === true);
    expect(repairs).toHaveLength(1);
    const repair = repairs[0] as { reservedForGatesMs: number; priorLoopNotes: string };
    // The failing cycle took real time to run its gates; that much was held back.
    expect(repair.reservedForGatesMs).toBeGreaterThan(0);
    expect(repair.priorLoopNotes).toContain("derived by the harness");
    expect(repair.priorLoopNotes).toContain("files it edited: src/greet.js");
    expect(repair.priorLoopNotes).toContain(
      "matched nothing, so these names are not in the workspace: /emitWsNeeded/ under src",
    );
    // The account reached the repair loop as part of its brief, not as a system instruction.
    const prompts = evidence
      .records()
      .filter((record) => record.type === "model-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)));
    expect(prompts.at(-1)).toContain("Account of the previous loop");
    expect(prompts[0]).not.toContain("Account of the previous loop");
  });
});

describe("a repair after a rolled-back repair (scripted model)", () => {
  it("is briefed on the regression that caused the rollback while working from the restored files", async () => {
    // A lint rule the first repair will break while fixing the test, as mime launch 11's second
    // repair passed every planned check and broke seven project tests.
    await write(
      "scripts/lint.mjs",
      "import { readFileSync } from 'node:fs';\n" +
        "if (readFileSync('src/greet.js', 'utf8').includes('var ')) {\n" +
        "  console.error('src/greet.js: \"var\" is not allowed');\n  process.exit(1);\n}\n",
    );
    await git("add", "scripts/lint.mjs");
    await git("commit", "-qm", "lint rule");
    const writeGreet = (callId: string, content: string) =>
      respondWithToolCalls("writing", [
        { callId, toolName: "write", input: { path: "src/greet.js", content } },
      ]);
    const result = await task(
      [
        respondWithToolCalls("declaring", [
          { callId: "c0", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
        ]),
        writeGreet("c1", broken),
        respondWithText("done"),
        writeGreet("c2", "export function greet() {\n  var word = 'hello';\n  return word;\n}\n"),
        respondWithText("fixed the greeting"),
        writeGreet("c3", "export function greet() {\n  const word = 'hello';\n  return word;\n}\n"),
        respondWithText("fixed it without var"),
      ],
      {
        attempts: 2,
        gateOptions: { commandOverrides: { ...gateOverrides, lint: "node scripts/lint.mjs" } },
      },
    );

    expect(result.gates.outcome.attempts.map((one) => one.decision.accepted)).toEqual([
      false,
      true,
    ]);
    expect(result.green).toBe(true);
    const prompts = evidence
      .records()
      .filter((record) => record.type === "model-call")
      .map((record) => JSON.stringify(evidence.payloads().get(record.payloadDigest)));
    const secondRepair = prompts.find((prompt) => prompt.includes("This is attempt 2 of 2"));
    expect(secondRepair).toContain("Attempt 1 was rolled back");
    expect(secondRepair).toContain("Gates it fixed: tests. Gates it broke: lint.");
    expect(secondRepair).toContain('\\"var\\" is not allowed');
    expect(secondRepair).toContain("The workspace is in the state gate cycle 0 checked");
    expect(secondRepair).not.toContain("Prior checked attempt");
    // The first repair was never told about a rollback, since there had been none.
    const firstRepair = prompts.find((prompt) => prompt.includes("This is attempt 1 of 2"));
    expect(firstRepair).not.toContain("rolled back");
  }, 60000);
});

describe("an answer the model already has", () => {
  it("is handed back as a notice in the answer's place, while the ledger keeps every result whole", async () => {
    const inspection = (callId: string) =>
      respondWithToolCalls("checking the manifest", [
        { callId, toolName: "read", input: { path: "src/greet.js" } },
      ]);
    const fixture = createFixtureModelClient({
      modelId: "fixture:worker",
      turns: Array.from({ length: 12 }, (_, index) => inspection(`look-${index}`)),
    });
    const result = await task([], {
      maxSteps: 20,
      model: createRecordingModelClient(fixture, evidence),
    });
    expect(result.loop.stopReason).toBe("stalled");

    // What each call carried as the last tool answer: the file once, the notice after.
    const lastToolOutput = (request: ModelRequest): string => {
      const turn = request.messages.findLast((message) => message.role === "tool");
      return turn?.role === "tool" ? (turn.outcomes[0]?.output ?? "") : "";
    };
    expect(lastToolOutput(fixture.requests[1] as ModelRequest)).toContain("return 'hello'");
    expect(lastToolOutput(fixture.requests[2] as ModelRequest)).toContain(
      "[harness notice: already answered]",
    );
    expect(lastToolOutput(fixture.requests[2] as ModelRequest)).toContain("once now");
    expect(lastToolOutput(fixture.requests[2] as ModelRequest)).not.toContain("return 'hello'");
    // What the chokepoint recorded for that second call is the file it actually read.
    const reads = evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map(
        (record) =>
          evidence.payloads().get(record.payloadDigest) as { decision: string; output: string },
      )
      .filter((call) => call.decision === "allowed");
    expect(reads[1]?.output).toContain("return 'hello'");
  });
});

describe("a call repeated after an edit", () => {
  it("is answered through the chokepoint, not replaced by the notice, when the answer is unchanged", async () => {
    // A listing whose answer the edit does not change: the file set is the same before and after.
    const listing = (callId: string) =>
      respondWithToolCalls("checking", [{ callId, toolName: "list", input: { path: "src" } }]);
    const fixture = createFixtureModelClient({
      modelId: "fixture:worker",
      turns: [
        respondWithToolCalls("declare", [
          { callId: "declare", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
        ]),
        listing("before"),
        respondWithToolCalls("change", [
          {
            callId: "edit",
            toolName: "edit",
            input: { path: "src/greet.js", find: "'hello'", replace: "'hi'" },
          },
        ]),
        listing("after"),
        respondWithText("done"),
      ],
    });
    await task([], { maxSteps: 8, model: createRecordingModelClient(fixture, evidence) });
    const lastToolOutput = (request: ModelRequest): string => {
      const turn = request.messages.findLast((message) => message.role === "tool");
      return turn?.role === "tool" ? (turn.outcomes[0]?.output ?? "") : "";
    };
    expect(lastToolOutput(fixture.requests[2] as ModelRequest)).toContain("greet.js");
    expect(lastToolOutput(fixture.requests[4] as ModelRequest)).toContain("greet.js");
    expect(lastToolOutput(fixture.requests[4] as ModelRequest)).not.toContain(
      "[harness notice: already answered]",
    );
  });
});

describe("a repair attempt with no usable budget", () => {
  it("is withheld on the record and ends the attempts, rather than run empty and measured", async () => {
    const result = await task(
      [
        respondWithToolCalls("declare", [
          { callId: "declare", toolName: "declare_file_set", input: { files: ["src/greet.js"] } },
        ]),
        respondWithToolCalls("change", [
          { callId: "break", toolName: "write", input: { path: "src/greet.js", content: broken } },
        ]),
        respondWithText("done"),
        respondWithText("No repair found."),
        respondWithText("No repair found."),
      ],
      // Three answers' worth and nothing to spare: after the first loop fewer tokens remain
      // than one answer could take, so no attempt can be dispatched honestly.
      { attempts: 3, maxTokens: 8_000 },
    );

    expect(result.green).toBe(false);
    // One attempt recorded as withheld, and the cap not spent on empty loops after it.
    expect(result.gates.outcome.attempts).toHaveLength(1);
    const stops = evidence
      .records()
      .filter((record) => record.type === "session-stopped")
      .map((record) => evidence.payloads().get(record.payloadDigest) as Record<string, unknown>);
    expect(stops.filter((stop) => stop.stopReason === "repair-withheld")).toMatchObject([
      { repair: true, attempt: 1, floor: { maxTokens: 8192 }, remaining: { maxTokens: 7955 } },
    ]);
    // The repair turns were never asked for: three model calls, the first loop's and no more.
    expect(evidence.records().filter((record) => record.type === "model-call")).toHaveLength(3);
    expect(result.gates.outcome.settled).toBe("escalated");

    // The assessment names the loop's own stop as its lifecycle record, never the withheld
    // attempt's: naming that one put a stop reason beside a lifecycle it does not carry, and the
    // bundle's own verifier refused every run that withheld an attempt.
    const assessment = evidence.records().findLast((record) => record.type === "run-assessment");
    const inputs = (
      evidence.payloads().get(assessment?.payloadDigest ?? "") as {
        inputs: { lifecycle: string; lifecycleRecord: string };
      }
    ).inputs;
    const named = evidence.payloads().get(inputs.lifecycleRecord) as { stopReason: string };
    expect(named.stopReason).toBe(inputs.lifecycle);
    const spec = evidence.records().find((record) => record.type === "run-spec-sealed");
    if (!spec) throw Error("missing run seal");
    const key = createEphemeralSigningKey();
    const destination = join(scratch, "withheld-bundle");
    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination,
      signingKey: key,
      clock: createTestClock(),
      attestation: signAttestation(
        buildAttestation({
          runId: evidence.sessionId,
          specDigest: spec.payloadDigest,
          sourceCommit: "0".repeat(40),
          patchDigest: digestOfBytes(""),
          chainHead: evidence.head().hash,
          toolVersion: "test",
          executionMode: result.verdict.executionTrust,
          verdict: { ...result.verdict },
        }),
        key,
      ),
    });
    const verified = await run(process.execPath, [
      join(destination, "verify.mjs"),
      destination,
    ]).catch((failure: { stdout: string }) => failure);
    // The bundle's own verifier re-derives the assessment from the records it names.
    expect(verified.stdout).toMatch(/PASS {2}run assessment \d+ re-derived/);
    expect(verified.stdout).not.toMatch(/FAIL {2}run assessment/);
  });
});

describe("the token allowance under a contract that names no token budget", () => {
  const contractWith = (maxTokens?: number) =>
    parseTaskContract({
      version: 3,
      scopeKind: "workspace",
      taskId: "allowance",
      objective: "add a shout helper",
      dependsOn: [],
      allowedPaths: ["**"],
      immutablePaths: [],
      allowedTools: ["read", "write", "edit", "list", "search", "shell"],
      network: "unrestricted",
      requiredChecks: [],
      budget: { maxSteps: 8, maxWallMs: 60_000, ...(maxTokens === undefined ? {} : { maxTokens }) },
      riskTier: "medium",
      scopeAuthority: "human",
    });
  const sealedBudget = () => {
    const spec = evidence.records().find((record) => record.type === "run-spec-sealed");
    const payload = evidence.payloads().get(spec?.payloadDigest ?? "") as {
      spec: { budgets: { maxTokens: number } };
    };
    return payload.spec.budgets.maxTokens;
  };

  it("lets the run's own allowance stand, and still bounds it by a contract that names one", async () => {
    // A launcher asked for 8,000,000 and the contract said nothing about tokens; the run used to
    // seal 1,000,000, the default standing in for the contract's silence.
    await task([respondWithText("done")], { contract: contractWith(), maxTokens: 8_000_000 });
    expect(sealedBudget()).toBe(8_000_000);
  });

  it("takes the smaller of the two where the contract does name a token budget", async () => {
    await task([respondWithText("done")], { contract: contractWith(500), maxTokens: 8_000_000 });
    expect(sealedBudget()).toBe(500);
  });
});

describe("a verbose command in the worker's loop", () => {
  // Three thousand lines with one failure in the middle and a non-zero exit, as a test runner
  // prints them. Run for real, through the worker's own shell tool and chokepoint. The exit is
  // set, not called: on Linux a pipe write past the kernel buffer is queued, and process.exit
  // drops the queue (CI captured 697 of the 3,000 lines); the process ending on its own drains it.
  const verbose =
    "node -e \"for (let i = 1; i <= 3000; i++) console.log(i === 1500 ? 'not ok ' + i + ' - the middle case fails' : 'ok ' + i + ' - a passing case with a description'); process.exitCode = 1\"";

  it("is resent as a bounded view, its omitted lines come back by reference, and the gates decide as before", async () => {
    const requests: ModelRequest[] = [];
    const turn = (made: FixtureTurn) => {
      if (made.kind !== "response") throw new Error("a scripted response");
      return made.response;
    };
    const lastToolOutput = (request: ModelRequest) => {
      const last = request.messages.at(-1);
      return last?.role === "tool" ? (last.outcomes[0]?.output ?? "") : "";
    };
    const model: ModelClient = {
      modelId: "fixture:worker",
      generate: (request) => {
        requests.push(request);
        switch (requests.length) {
          case 1:
            return Promise.resolve(
              turn(
                respondWithToolCalls("testing", [
                  { callId: "t", toolName: "shell", input: { command: verbose } },
                ]),
              ),
            );
          case 2: {
            const record = /evidence record (sha256:[0-9a-f]{64})/.exec(
              lastToolOutput(request),
            )?.[1];
            return Promise.resolve(
              turn(
                respondWithToolCalls("reading the failure", [
                  {
                    callId: "r",
                    toolName: "read_recorded_output",
                    input: { record, contains: "not ok" },
                  },
                ]),
              ),
            );
          }
          case 3:
            return Promise.resolve(turn(goodTurns(stillGreen)[0] as FixtureTurn));
          case 4:
            return Promise.resolve(turn(goodTurns(stillGreen)[1] as FixtureTurn));
          default:
            return Promise.resolve(turn(respondWithText("done")));
        }
      },
    };
    const result = await task([], { model: createRecordingModelClient(model, evidence) });

    const shown = lastToolOutput(requests[1] as ModelRequest);
    expect(shown.length).toBeLessThan(14_000);
    expect(shown).toContain(
      "recorded status: exit code 1, not timed out, not cancelled, capture complete",
    );
    expect(shown).toMatch(/1,502: not ok 1500 - the middle case fails/);
    // Every later request carries the view, not the output: one command no longer dominates them.
    for (const request of requests.slice(1))
      expect(JSON.stringify(request.messages).length).toBeLessThan(40_000);
    expect(lastToolOutput(requests[2] as ModelRequest)).toContain(
      "1,502: not ok 1500 - the middle case fails",
    );
    // The ledger keeps the output as captured.
    const recorded = evidence
      .records()
      .filter((record) => record.type === "tool-call")
      .map(
        (record) =>
          evidence.payloads().get(record.payloadDigest) as {
            toolName?: string;
            decision?: string;
            output?: string;
          },
      )
      .find((payload) => payload.toolName === "shell" && payload.decision === "allowed");
    expect(recorded?.output?.length).toBeGreaterThan(100_000);
    expect(result.gates.outcome.settled).toBe("green");
    expect(result.green).toBe(true);
  });
});

describe("the gates after a loop that spent its wall", () => {
  /** Declares, writes, then answers nothing within the wall: the loop stops at max-wall-time. */
  function spendsItsWall(contents: string): ModelClient {
    let calls = 0;
    const fixture = createFixtureModelClient({
      modelId: "fixture:worker",
      turns: goodTurns(contents).slice(0, 2),
    });
    return {
      modelId: fixture.modelId,
      generate: (request) => {
        calls += 1;
        if (calls <= 2) return fixture.generate(request);
        return new Promise((_resolve, reject) => {
          request.abortSignal.addEventListener("abort", () => reject(request.abortSignal.reason), {
            once: true,
          });
        });
      },
    };
  }

  it("still runs the required checks on the exact tree the loop delivered", async () => {
    // C1: the loop spent its wall, and the end of that wall refused the build, lint and tests
    // commands before they could spawn, so nothing measured the delivered change.
    const result = await task([], {
      model: createRecordingModelClient(spendsItsWall(stillGreen), evidence),
      clock: createSystemClock(),
      maxWallTimeMs: 2_000,
    });
    expect(result.loop.stopReason).toBe("max-wall-time");
    const tests = result.gates.outcome.finalCycle.runs.find((run) => run.gateId === "tests");
    expect(tests?.status).toBe("passed");
    expect(JSON.stringify(result.gates.outcome.finalCycle.runs)).not.toContain(
      "refused before spawn",
    );
    // The run did not finish its work in its allowance, and says so; it was not cancelled.
    expect(result.green).toBe(false);
    expect(Object.values(result.verdict.reasons).join(" ")).toContain(
      "the run stopped as max-wall-time",
    );
    expect(Object.values(result.verdict.reasons).join(" ")).not.toContain("the run was cancelled");
  }, 60_000);

  it("refuses the checks when the run is cancelled, and says it was", async () => {
    const cancel = new AbortController();
    const result = await task([], {
      model: createRecordingModelClient(spendsItsWall(stillGreen), evidence),
      clock: createSystemClock(),
      maxWallTimeMs: 60_000,
      abortSignal: cancel.signal,
      emit: (event) => {
        if (event.type === "tool-outcome" && event.toolName === "write")
          cancel.abort("cancelled from the keyboard");
      },
    });
    const tests = result.gates.outcome.finalCycle.runs.find((run) => run.gateId === "tests");
    expect(tests?.status).toBe("not-applicable");
    expect(result.green).toBe(false);
    expect(Object.values(result.verdict.reasons).join(" ")).toContain("the run was cancelled");
  }, 60_000);

  it("stops the checks it was given time for at the end of the verification allowance, and calls the run incomplete", async () => {
    const verification = new AbortController();
    const result = await task([], {
      model: createRecordingModelClient(spendsItsWall(stillGreen), evidence),
      clock: createSystemClock(),
      maxWallTimeMs: 1_000,
      verificationSignal: verification.signal,
      gateOptions: {
        commandOverrides: { ...gateOverrides, tests: 'node -e "setTimeout(() => {}, 30000)"' },
      },
      emit: (event) => {
        if (event.type === "stopped")
          setTimeout(
            () =>
              verification.abort(
                "the run's total allowance ended before final verification finished",
              ),
            500,
          );
      },
    });
    const tests = result.gates.outcome.finalCycle.runs.find((run) => run.gateId === "tests");
    expect(tests?.status).not.toBe("passed");
    expect(result.green).toBe(false);
    expect(Object.values(result.verdict.reasons).join(" ")).toContain("the run was cancelled");
  }, 60_000);
});

describe("a follow-up owed once the gates are green", () => {
  it("leaves a finished run's lifecycle when the follow-up runs out of wall and its change is rolled back", async () => {
    // The work completes green; the follow-up breaks greet and then answers nothing until its
    // wall ends it. The ratchet rolls the broken change back, so what is delivered is the finished
    // work, and the run is not read as stopped at its wall.
    let calls = 0;
    const fixture = createFixtureModelClient({
      modelId: "fixture:worker",
      turns: [
        ...goodTurns(stillGreen),
        respondWithToolCalls("following up", [
          { callId: "f1", toolName: "write", input: { path: "src/greet.js", content: broken } },
        ]),
      ],
    });
    const model: ModelClient = {
      modelId: fixture.modelId,
      generate: (request) => {
        calls += 1;
        if (calls <= 4) return fixture.generate(request);
        return new Promise((_resolve, reject) => {
          request.abortSignal.addEventListener("abort", () => reject(request.abortSignal.reason), {
            once: true,
          });
        });
      },
    };
    const result = await task([], {
      model: createRecordingModelClient(model, evidence),
      clock: createSystemClock(),
      attempts: 1,
      maxWallTimeMs: 20_000,
      followUp: { identity: "sha256:outcomes", brief: "Requested behaviour no check exercises." },
    });
    expect(result.gates.outcome.followUp).toMatchObject({
      state: "given",
      attempt: 1,
      accepted: false,
    });
    expect(readFileSync(join(workspace, "src/greet.js"), "utf8")).toBe(stillGreen);
    expect(result.loop.stopReason).toBe("completed");
    expect(result.green).toBe(true);
    // The bundle's own verifier re-derives the assessment from the cycle the workspace was left in.
    expect(await verifiedAssessment(result, "follow-up-bundle")).toMatch(
      /PASS {2}run assessment \d+ re-derived/,
    );
  }, 60_000);
});

/** The bundle's own verifier over this run's chain: its lines about the run assessment. */
async function verifiedAssessment(
  result: Awaited<ReturnType<typeof runAgentTask>>,
  name: string,
): Promise<string> {
  const spec = evidence.records().find((record) => record.type === "run-spec-sealed");
  if (!spec) throw Error("missing run seal");
  const key = createEphemeralSigningKey();
  const destination = join(scratch, name);
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination,
    signingKey: key,
    clock: createTestClock(),
    attestation: signAttestation(
      buildAttestation({
        runId: evidence.sessionId,
        specDigest: spec.payloadDigest,
        sourceCommit: "0".repeat(40),
        patchDigest: digestOfBytes(""),
        chainHead: evidence.head().hash,
        toolVersion: "test",
        executionMode: result.verdict.executionTrust,
        verdict: { ...result.verdict },
      }),
      key,
    ),
  });
  const verified = await run(process.execPath, [
    join(destination, "verify.mjs"),
    destination,
  ]).catch((failure: { stdout: string }) => failure);
  return verified.stdout
    .split("\n")
    .filter((line) => line.includes("run assessment"))
    .join("\n");
}

describe("a run whose last repair is rolled back", () => {
  it("verifies: the assessment names the gate runs of the cycle the workspace was left in", async () => {
    // The work breaks greet; the one repair breaks the syntax as well, so lint regresses and the
    // ratchet rolls it back. Its gate runs are the latest on the chain and describe an undone tree.
    const unparsable = "export function greet( {\n";
    const result = await task(
      [
        ...goodTurns(broken),
        respondWithToolCalls("repairing", [
          { callId: "r1", toolName: "write", input: { path: "src/greet.js", content: unparsable } },
        ]),
        respondWithText("repaired"),
      ],
      { attempts: 1 },
    );
    expect(result.gates.outcome.attempts.map((one) => one.decision.accepted)).toEqual([false]);
    expect(readFileSync(join(workspace, "src/greet.js"), "utf8")).toBe(broken);
    const lines = await verifiedAssessment(result, "rolled-back-bundle");
    expect(lines).toMatch(/PASS {2}run assessment \d+ re-derived/);
    expect(lines).not.toMatch(/FAIL {2}run assessment/);
  }, 60_000);
});
