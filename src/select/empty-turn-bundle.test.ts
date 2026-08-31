import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createStubCommandRunner } from "../gates/test-doubles.ts";
import { createFixtureModelClient, respondWithText } from "../providers/fixture-provider.ts";
import type { CalibrationCase } from "./calibration-case.ts";
import { type CalibrationRunDependencies, runCalibrationRepeat } from "./calibration-run.ts";
import { summarizeByModel } from "./calibration-summary.ts";

/**
 * The shape two calibration bundles came back in: a local pairing that answered every turn with
 * nothing, over and over, and a bundle that recorded those turns with nothing saying they were
 * empty. Synthesized rather than lifted, because the corrupt bundles are session data and this
 * repository holds none; what is reproduced is the turn shape and what the ledger did with it.
 *
 * The gate this fixture holds: an empty turn is marked as empty by the harness at the record
 * that carries it, and a repeat made only of empty turns is an abstention naming its reason
 * rather than a run anything can read as executed.
 */

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
  root = await mkdtemp(join(tmpdir(), "swarm-empty-turn-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(clock, createFixedRandom()),
    clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function dependencies(
  overrides: Partial<CalibrationRunDependencies> = {},
): CalibrationRunDependencies {
  return {
    evidence,
    clock,
    random: createFixedRandom(),
    createModel: () => emptyTurnModel(""),
    // Exit zero on purpose: the seed workspace passes its own command untouched, which is how
    // a repeat that did nothing at all can read as green if nothing asks whether it ran.
    commands: createStubCommandRunner(() => ({ exitCode: 0, stdout: "ok" })),
    probeMemory: () => Promise.resolve(null),
    scratchRoot: join(root, "scratch"),
    maxSteps: 8,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

/** A pairing whose every turn carries the given nothing, which is what the corrupt runs saw. */
function emptyTurnModel(text: string) {
  return createFixtureModelClient({
    modelId: "fixture:empty",
    turns: [respondWithText(text), respondWithText(text), respondWithText(text)],
  });
}

function modelCallPayloads(): readonly Record<string, JsonValue>[] {
  const payloads = evidence.payloads();
  return evidence
    .records()
    .filter((record) => record.type === "model-call")
    .map((record) => payloads.get(record.payloadDigest) as Record<string, JsonValue>);
}

describe("an assistant turn that carried nothing", () => {
  it("is marked empty by the harness on the record that carries it into the bundle", async () => {
    await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:empty", repeat: 1 },
      dependencies(),
    );

    const calls = modelCallPayloads();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.content).toMatchObject({
        textCharacters: 0,
        toolCalls: 0,
        empty: true,
        emptyReason: "no-content",
      });
    }
  });

  it("names whitespace apart from absence, because they point at different layers", async () => {
    await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:empty", repeat: 1 },
      dependencies({ createModel: () => emptyTurnModel("   \n\t ") }),
    );

    for (const call of modelCallPayloads()) {
      expect(call.content).toMatchObject({ empty: true, emptyReason: "whitespace-only-text" });
    }
  });

  it("leaves a turn that carried something unmarked", async () => {
    await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:answering", repeat: 1 },
      dependencies({
        createModel: () =>
          createFixtureModelClient({
            modelId: "fixture:answering",
            turns: [respondWithText("I read the file and it is already loud enough.")],
          }),
      }),
    );

    expect(modelCallPayloads()[0]?.content).toMatchObject({ empty: false, emptyReason: null });
  });
});

describe("a repeat made only of empty turns", () => {
  it("is an abstention with a reason code, never an executed run", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:empty", repeat: 1 },
      dependencies(),
    );

    expect(observation.executed).toBe(false);
    expect(observation.abstention).toMatchObject({
      reason: "every-turn-empty",
      emptyReasons: { "no-content": 1 },
    });
  });

  it("carries the abstention into the bundle, not only into the return value", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:empty", repeat: 1 },
      dependencies(),
    );

    const payload = (await evidence.blobs.get(observation.record)) as Record<string, JsonValue>;
    expect(payload.executed).toBe(false);
    expect(payload.turnsAnswered).toBe(0);
    expect(payload.abstention).toMatchObject({ reason: "every-turn-empty" });
  });

  it("stays out of every dimension, and is counted under its reason rather than as a zero", async () => {
    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "fixture:empty", repeat: 1 },
      dependencies(),
    );

    const [summary] = summarizeByModel([observation]);

    expect(summary?.executedRepeats).toBe(0);
    expect(summary?.abstentions).toEqual({ "every-turn-empty": 1 });
    // The stub gate exits zero over a workspace nothing touched, so this is the number the
    // corrupt bundles reported: green, from a run that never happened.
    expect(observation.gatePassed).toBe(true);
    expect(summary?.dimensions["gate-pass"].samples).toBe(0);
  });
});
