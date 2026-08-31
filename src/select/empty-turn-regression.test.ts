import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelResponse } from "../core/model-client.ts";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createStubCommandRunner } from "../gates/test-doubles.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import type { CalibrationCase } from "./calibration-case.ts";
import { type CalibrationRunDependencies, runCalibrationRepeat } from "./calibration-run.ts";

/**
 * The turns that made two calibration bundles unusable, replayed exactly as the ledgers hold
 * them. Neither carried text and neither carried a tool call, and before the content verdict
 * existed both reached a summary as ordinary runs of the model: one was scored as a case the
 * model failed, and the other as a repeat that simply did not go green.
 */
interface RecordedTurn {
  readonly session: string;
  readonly sequence: number;
  readonly actor: string;
  readonly why: string;
  readonly finishReason: string;
  readonly response: {
    readonly text: string;
    readonly toolCalls: readonly [];
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly finishReason: string;
    readonly performance: ModelResponse["performance"];
  };
}

async function corruptTurns(): Promise<readonly RecordedTurn[]> {
  const text = await readFile(
    new URL("../evidence/fixtures/empty-assistant-turns.json", import.meta.url),
    "utf8",
  );
  return (JSON.parse(text) as { turns: RecordedTurn[] }).turns;
}

function replay(turn: RecordedTurn): FixtureTurn {
  return { kind: "response", response: { ...turn.response, toolCalls: [] } };
}

const one: CalibrationCase = {
  id: "pass3-isolation-none-coverage",
  taskClass: "edit",
  prompt: "clamp returns low below the range, high above it, and the value inside it.",
  seed: { "clamp.mjs": "export const clamp = (v, lo, hi) => v;\n" },
  gateCommand: "node --test",
  origin: "bundled",
  addedAt: "2026-08-13",
};

let root = "";
let evidence: EvidenceRecorder;
const clock = createTestClock();

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

function dependencies(turns: readonly FixtureTurn[]): CalibrationRunDependencies {
  return {
    evidence,
    clock,
    random: createFixedRandom(),
    createModel: () => createFixtureModelClient({ modelId: "local:qwen3.6:35b-a3b", turns }),
    // Green on purpose. A repeat that measured nothing must not be rescued by a gate that
    // happened to pass over a workspace nobody touched, and must not be sunk by one either.
    commands: createStubCommandRunner(() => ({ exitCode: 0, stdout: "ok" })),
    probeMemory: () => Promise.resolve(null),
    scratchRoot: join(root, "scratch"),
    maxSteps: 8,
    abortSignal: new AbortController().signal,
  };
}

describe("the turns that corrupted the 2026-08-23 and 2026-08-24 calibration bundles", () => {
  it("carries both of them, so the fixture is the bundles and not a guess at them", async () => {
    const turns = await corruptTurns();

    expect(turns).toHaveLength(2);
    for (const turn of turns) {
      expect(turn.response.text).toBe("");
      expect(turn.response.toolCalls).toHaveLength(0);
    }
    expect(turns.map((turn) => turn.finishReason)).toEqual(["other", "length"]);
  });

  it("refuses to call a repeat of nothing but an empty turn an executed run", async () => {
    const [first] = await corruptTurns();
    if (first === undefined) {
      throw new Error("fixture is empty");
    }

    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "local:qwen3.6:35b-a3b", repeat: 2 },
      dependencies([replay(first)]),
    );

    expect(observation.executed).toBe(false);
    expect(observation.abstentionReason).toBe("no-content");
    expect(observation.modelCalls).toMatchObject({
      calls: 1,
      validTurns: 0,
      emptyTurns: 1,
      emptyTurnReasons: { "no-content": 1 },
    });
  });

  it("puts the abstention and its reason in the record, not only in the return value", async () => {
    const [first] = await corruptTurns();
    if (first === undefined) {
      throw new Error("fixture is empty");
    }

    await runCalibrationRepeat(
      { case: one, modelSpec: "local:qwen3.6:35b-a3b", repeat: 2 },
      dependencies([replay(first)]),
    );

    const payloads = evidence.payloads();
    const run = evidence
      .records()
      .filter((record) => record.type === "calibration-run")
      .map((record) => payloads.get(record.payloadDigest));

    expect(run).toHaveLength(1);
    expect(run[0]).toMatchObject({
      executed: false,
      abstained: true,
      abstentionReason: "no-content",
      validTurns: 0,
      emptyTurns: 1,
    });
  });

  it("names the empty turns inside a repeat that did otherwise run", async () => {
    // The second fixture turn is the one that spent its whole output budget saying nothing.
    // The repeat around it answered twice, so it stays executed; what changes is that the
    // bundle now says a turn was empty and which kind of empty it was. Replayed twice
    // because the loop samples a spiralling turn again before giving up on it, and both
    // samples are turns that reached the ledger.
    const turns = await corruptTurns();
    const capped = turns[1];
    if (capped === undefined) {
      throw new Error("fixture is short");
    }

    const observation = await runCalibrationRepeat(
      { case: one, modelSpec: "local:qwen3.6:35b-a3b", repeat: 1 },
      dependencies([
        respondWithToolCalls("reading", [{ callId: "c1", toolName: "list", input: { path: "." } }]),
        respondWithToolCalls("reading again", [
          { callId: "c2", toolName: "read", input: { path: "clamp.mjs" } },
        ]),
        replay(capped),
        replay(capped),
      ]),
    );

    expect(observation.executed).toBe(true);
    expect(observation.abstentionReason).toBeNull();
    expect(observation.modelCalls).toMatchObject({
      validTurns: 2,
      emptyTurns: 2,
      emptyTurnReasons: { "output-cap-without-content": 2 },
    });
  });

  it("stamps the verdict on the model-call record itself, where a bundle reader finds it", async () => {
    const [first] = await corruptTurns();
    if (first === undefined) {
      throw new Error("fixture is empty");
    }

    await runCalibrationRepeat(
      { case: one, modelSpec: "local:qwen3.6:35b-a3b", repeat: 2 },
      dependencies([replay(first)]),
    );

    const payloads = evidence.payloads();
    const calls = evidence
      .records()
      .filter((record) => record.type === "model-call")
      .map((record) => payloads.get(record.payloadDigest));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ content: { valid: false, reason: "no-content" } });
  });
});
