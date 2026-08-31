// biome-ignore-all lint/suspicious/noTemplateCurlyInString: seed files are JavaScript source, and a template literal in one is the file's own syntax rather than a mistake in this test.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "../core/model-client.ts";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createStubCommandRunner } from "../gates/test-doubles.ts";
import {
  createFixtureModelClient,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import type { CalibrationCase } from "./calibration-case.ts";
import { caseDigest } from "./calibration-case.ts";
import {
  backendTakesSeed,
  type CalibrationRunDependencies,
  calibrationSampling,
  runCalibrationRepeat,
  seedForRepeat,
} from "./calibration-run.ts";

let root = "";
let evidence: EvidenceRecorder;
const clock = createTestClock();

const one: CalibrationCase = {
  id: "edit-loud-greeting",
  taskClass: "edit",
  prompt: "make greet shout when asked",
  seed: { "greet.mjs": "export const greet = (who) => `hello ${who}`;\n" },
  gateCommand: "node --test",
  origin: "bundled",
  addedAt: "2026-08-13",
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-calibrate-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(clock, createFixedRandom()),
    clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A model that writes the fix and then says it is done. */
function fixingModel() {
  return createFixtureModelClient({
    modelId: "fixture:good",
    turns: [
      respondWithToolCalls(
        "I will rewrite greet.mjs.",
        [
          {
            callId: "c1",
            toolName: "write",
            input: { path: "greet.mjs", content: "export const greet = () => 'HELLO';\n" },
          },
        ],
        { input: 100, output: 40 },
        { firstTokenMs: 180, outputTokensPerSecond: 30, responseTimeMs: 1_500 },
      ),
      respondWithText(
        "done",
        { input: 120, output: 10 },
        {
          firstTokenMs: 220,
          outputTokensPerSecond: 20,
          responseTimeMs: 500,
        },
      ),
    ],
  });
}

function dependencies(
  overrides: Partial<CalibrationRunDependencies> = {},
): CalibrationRunDependencies {
  return {
    evidence,
    clock,
    random: createFixedRandom(),
    createModel: () => fixingModel(),
    commands: createStubCommandRunner(() => ({ exitCode: 0, stdout: "ok" })),
    probeMemory: () => Promise.resolve(null),
    scratchRoot: join(root, "scratch"),
    maxSteps: 8,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe("runCalibrationRepeat", () => {
  it("seeds a scratch workspace from the case and lets the model work in it", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );

    // The workspace is left for the caller to clear, so what the model did is inspectable.
    expect(await readFile(join(observation.workspace, "greet.mjs"), "utf8")).toContain("HELLO");
    expect(observation.caseDigest).toBe(caseDigest(one));
  });

  it("runs the case's own command to decide whether it went green", async () => {
    const commands = createStubCommandRunner(() => ({ exitCode: 0 }));
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies({ commands }),
    );

    expect(commands.commands).toEqual(["node --test"]);
    expect(observation).toMatchObject({ gateExitCode: 0, gatePassed: true });
  });

  it("reports a case the model did not solve as not green", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies({ commands: createStubCommandRunner(() => ({ exitCode: 1 })) }),
    );

    expect(observation).toMatchObject({ gateExitCode: 1, gatePassed: false });
  });

  it("counts the tool calls the model made and the writes that applied", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );

    expect(observation.toolCalls).toMatchObject({
      attempted: 1,
      malformed: 0,
      writesAttempted: 1,
      writesApplied: 1,
      validityRate: 1,
      applyRate: 1,
    });
  });

  it("counts a call the chokepoint could not act on against the model", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:bad", repeat: 1 },
      dependencies({
        createModel: () =>
          createFixtureModelClient({
            modelId: "fixture:bad",
            turns: [
              respondWithToolCalls("writing", [
                { callId: "c1", toolName: "wrigt", input: { path: "greet.mjs" } },
              ]),
              respondWithText("done"),
            ],
          }),
      }),
    );

    expect(observation.toolCalls).toMatchObject({ attempted: 1, malformed: 1, validityRate: 0 });
  });

  it("carries the timings the model reported through to the observation", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );

    expect(observation.modelCalls).toMatchObject({ calls: 2, outputTokens: 50 });
    expect(observation.modelCalls.firstTokenMs).toBe(200);
    expect(observation.modelCalls.tokensPerSecond).toBeCloseTo(25, 6);
  });

  it("keeps the largest memory reading it took while the run was in flight", async () => {
    const readings = [1_000, 4_000, 2_000];
    let index = 0;
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies({
        probeMemory: () => {
          const reading = readings[index] ?? null;
          index += 1;
          return Promise.resolve(reading);
        },
      }),
    );

    expect(observation.peakMemoryBytes).toBe(4_000);
  });

  it("reports no peak when nothing could measure memory", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );

    expect(observation.peakMemoryBytes).toBeNull();
  });

  it("writes the numbers to the ledger, so the summary cites a record", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );

    expect(observation.record).toMatch(/^sha256:/);
    const payload = (await evidence.blobs.get(observation.record)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      caseId: "edit-loud-greeting",
      model: "fixture:good",
      repeat: 1,
      gatePassed: true,
    });
  });

  it("gives each repeat its own workspace, so one cannot inherit another's state", async () => {
    const first = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 1 },
      dependencies(),
    );
    const second = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 2 },
      dependencies(),
    );

    expect(first.workspace).not.toBe(second.workspace);
    expect((await readdir(join(root, "scratch"))).sort()).toHaveLength(2);
  });
});

describe("what the decoding was", () => {
  it("gives each repeat its own seed, and the same one again for the same repeat", () => {
    const first = seedForRepeat("edit-01", "local:qwen3-coder:30b-a3b", 1);
    const second = seedForRepeat("edit-01", "local:qwen3-coder:30b-a3b", 2);

    expect(first).not.toBe(second);
    expect(seedForRepeat("edit-01", "local:qwen3-coder:30b-a3b", 1)).toBe(first);
  });

  it("gives two models and two cases different seeds for the same repeat", () => {
    expect(seedForRepeat("edit-01", "local:a", 1)).not.toBe(seedForRepeat("edit-01", "local:b", 1));
    expect(seedForRepeat("edit-01", "local:a", 1)).not.toBe(seedForRepeat("edit-02", "local:a", 1));
  });

  it("leaves decoding stochastic, because the report is about a spread", () => {
    expect(calibrationSampling.temperature).toBeGreaterThan(0);
    expect(calibrationSampling.topP).toBeGreaterThan(0);
    expect(calibrationSampling.topP).toBeLessThanOrEqual(1);
  });

  it("produces a seed a backend will take, not a float and not a negative", () => {
    for (let repeat = 1; repeat <= 20; repeat += 1) {
      const seed = seedForRepeat("case", "local:model", repeat);
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("what the pinned decoding reaches", () => {
  /**
   * A production run must be able to say what distribution its numbers were drawn under, and
   * the two places that has to hold are the request the provider was handed and the record a
   * reviewer reads. They are asserted together on purpose: either one alone can be right while
   * the run was decoded under the backend's own defaults.
   */
  it("pins temperature, top_p and the seed on the request the provider is handed", async () => {
    const requests: ModelRequest[] = [];
    await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:good", repeat: 3 },
      dependencies({
        createModel: () => {
          const inner = fixingModel();
          return {
            modelId: inner.modelId,
            generate: (request: ModelRequest) => {
              requests.push(request);
              return inner.generate(request);
            },
          };
        },
      }),
    );

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request.sampling).toEqual({
        temperature: calibrationSampling.temperature,
        topP: calibrationSampling.topP,
        seed: seedForRepeat(one.id, "fixture:good", 3),
      });
    }
  });

  it("records the same settings in the ledger, so the report can name what it drew under", async () => {
    await runCalibrationRepeat({ case: one, modelSpec: "fixture:good", repeat: 3 }, dependencies());

    const payloads = evidence.payloads();
    const modelCalls = evidence
      .records()
      .filter((record) => record.type === "model-call")
      .map((record) => payloads.get(record.payloadDigest) as { prompt: { sampling: unknown } });

    expect(modelCalls.length).toBeGreaterThan(0);
    for (const call of modelCalls) {
      expect(call.prompt.sampling).toEqual({
        temperature: calibrationSampling.temperature,
        topP: calibrationSampling.topP,
        seed: seedForRepeat(one.id, "fixture:good", 3),
      });
    }
  });

  it("records no seed where the backend would drop it, rather than one that replays nothing", async () => {
    expect(backendTakesSeed("local:qwen3-coder:30b-a3b")).toBe(true);
    expect(backendTakesSeed("openai:gpt-5")).toBe(true);
    expect(backendTakesSeed("anthropic:claude-opus-5")).toBe(false);
    expect(backendTakesSeed("google:gemini-3-pro")).toBe(false);
  });

  it("leaves the seed out of the settings for a backend that takes none", async () => {
    const requests: ModelRequest[] = [];
    await runCalibrationRepeat(
      { case: one, modelSpec: "anthropic:claude-opus-5", repeat: 1 },
      dependencies({
        createModel: () => {
          const inner = fixingModel();
          return {
            modelId: "anthropic:claude-opus-5",
            generate: (request: ModelRequest) => {
              requests.push(request);
              return inner.generate(request);
            },
          };
        },
      }),
    );

    expect(requests[0]?.sampling?.seed).toBeNull();
  });
});
