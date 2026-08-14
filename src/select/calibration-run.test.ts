// biome-ignore-all lint/suspicious/noTemplateCurlyInString: seed files are JavaScript source, and a template literal in one is the file's own syntax rather than a mistake in this test.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { type CalibrationRunDependencies, runCalibrationRepeat } from "./calibration-run.ts";

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
