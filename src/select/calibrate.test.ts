// biome-ignore-all lint/suspicious/noTemplateCurlyInString: seed files are JavaScript source, and a template literal in one is the file's own syntax rather than a mistake in this test.

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelClient, ModelRequest } from "../core/model-client.ts";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import { bundleSourceFromRecorder, exportBundle } from "../evidence/bundle.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { createEphemeralSigningKey } from "../evidence/signing.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { createNodeCommandRunner } from "../gates/node-command-runner.ts";
import {
  createFixtureModelClient,
  type FixtureTurn,
  respondWithText,
  respondWithToolCalls,
} from "../providers/fixture-provider.ts";
import type { ServedModelList } from "../providers/served-models.ts";
import { runCalibration } from "./calibrate.ts";
import type { CalibrationCase } from "./calibration-case.ts";
import { type GoldenSet, goldenSetVersion } from "./golden-set.ts";
import { preflightLocalModels, preflightRecord } from "./model-preflight.ts";

const run = promisify(execFile);
const clock = createTestClock(1_700_000_000_000);

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-calibration-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(clock, createFixedRandom()),
    clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * Two real cases rather than the shipping golden set. What is under test here is the
 * calibration engine, and the set it measures against grows permanently by design, so binding
 * these tests to it would make every future capture slow them down and rewrite their counts.
 * That the shipped cases themselves discriminate is proved in golden-set.test.ts.
 */
const fixtureCases: readonly CalibrationCase[] = [
  {
    id: "fixture-edit",
    taskClass: "edit",
    prompt: "greet.mjs should shout when its second argument is true. Make the suite pass.",
    seed: {
      "greet.mjs": "export function greet(who) {\n  return `hello ${who}`;\n}\n",
      "greet.test.mjs":
        'import { strict as assert } from "node:assert";\nimport { test } from "node:test";\nimport { greet } from "./greet.mjs";\n\ntest("greets by name", () => {\n  assert.equal(greet("world"), "hello world");\n});\n\ntest("shouts when asked to", () => {\n  assert.equal(greet("world", true), "HELLO WORLD");\n});\n',
    },
    gateCommand: "node --test",
    origin: "bundled",
    addedAt: "2026-08-14",
  },
  {
    id: "fixture-test-fix",
    taskClass: "test-fix",
    prompt: "The paginate test is failing. Fix the cause in paginate.mjs.",
    seed: {
      "paginate.mjs":
        "export function paginate(items, perPage) {\n  const pages = [];\n  for (let start = 0; start < items.length; start += perPage) {\n    pages.push(items.slice(start, start + perPage - 1));\n  }\n  return pages;\n}\n",
      "paginate.test.mjs":
        'import { strict as assert } from "node:assert";\nimport { test } from "node:test";\nimport { paginate } from "./paginate.mjs";\n\ntest("fills each page before starting the next", () => {\n  assert.deepEqual(paginate([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);\n});\n',
    },
    gateCommand: "node --test",
    origin: "bundled",
    addedAt: "2026-08-14",
  },
];

/** The real fixes for those cases, so a scripted model can genuinely solve them. */
const solutions: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "fixture-edit": {
    "greet.mjs":
      "export function greet(who, loud) {\n  const line = `hello ${who}`;\n  return loud ? line.toUpperCase() : line;\n}\n",
  },
  "fixture-test-fix": {
    "paginate.mjs":
      "export function paginate(items, perPage) {\n  const pages = [];\n  for (let start = 0; start < items.length; start += perPage) {\n    pages.push(items.slice(start, start + perPage));\n  }\n  return pages;\n}\n",
  },
};

interface ModelBehaviour {
  readonly solves: boolean;
  readonly tokensPerSecond: number;
  readonly firstTokenMs: number;
  /** Every dispatch refused, the way a backend not holding this model refuses one. */
  readonly dispatchFails?: boolean;
  /** Calls the chokepoint cannot act on, which is what the validity floor is a floor on. */
  readonly malformedCalls?: boolean;
}

/**
 * A scripted model that writes the real fix. The workspace, the tools, the chokepoint and the
 * gate command are all real, so what is measured here is a real run of a real case.
 */
function scriptFor(caseId: string, behaviour: ModelBehaviour): readonly FixtureTurn[] {
  const timings = {
    firstTokenMs: behaviour.firstTokenMs,
    outputTokensPerSecond: behaviour.tokensPerSecond,
    responseTimeMs: 1_000,
  };
  const tokens = { input: 200, output: behaviour.tokensPerSecond };
  if (behaviour.malformedCalls === true) {
    const calls = [0, 1, 2].map((index) =>
      respondWithToolCalls(
        "trying something",
        [{ callId: `m${index}`, toolName: "not-a-tool", input: { path: "greet.mjs" } }],
        tokens,
        timings,
      ),
    );
    return [...calls, respondWithText("I give up.", tokens, timings)];
  }
  if (!behaviour.solves) {
    return [respondWithText("I could not work out what to change.", tokens, timings)];
  }

  const writes = Object.entries(solutions[caseId] ?? {}).map(([path, content], index) =>
    respondWithToolCalls(
      `writing ${path}`,
      [{ callId: `c${index}`, toolName: "write", input: { path, content } }],
      tokens,
      timings,
    ),
  );
  return [...writes, respondWithText("done", tokens, timings)];
}

const behaviours: Readonly<Record<string, ModelBehaviour>> = {
  "local:capable": { solves: true, tokensPerSecond: 24, firstTokenMs: 900 },
  "local:quick-but-lost": { solves: false, tokensPerSecond: 96, firstTokenMs: 120 },
  "local:never-served": {
    solves: false,
    tokensPerSecond: 0,
    firstTokenMs: 0,
    dispatchFails: true,
  },
  "local:sloppy": {
    solves: false,
    tokensPerSecond: 96,
    firstTokenMs: 120,
    malformedCalls: true,
  },
};

/**
 * Picks its script from the prompt it was handed, the way a real model reads its task. The
 * harness therefore needs no hook telling the double which case is running.
 */
function createScriptedModel(modelSpec: string, cases: readonly CalibrationCase[]): ModelClient {
  const behaviour = behaviours[modelSpec] ?? {
    solves: false,
    tokensPerSecond: 1,
    firstTokenMs: 1,
  };
  if (behaviour.dispatchFails === true) {
    return {
      modelId: modelSpec,
      generate: () => Promise.reject(new Error(`model "${modelSpec}" is not loaded`)),
    };
  }
  let inner: ModelClient | null = null;

  return {
    modelId: modelSpec,
    generate(request: ModelRequest) {
      if (inner === null) {
        const first = request.messages[0];
        const prompt = first?.role === "user" ? first.text : "";
        const one = cases.find((candidate) => candidate.prompt === prompt);
        inner = createFixtureModelClient({
          modelId: modelSpec,
          turns: scriptFor(one?.id ?? "", behaviour),
        });
      }
      return inner.generate(request);
    },
  };
}

function fixtureGoldenSet(): GoldenSet {
  return {
    cases: fixtureCases,
    version: goldenSetVersion(fixtureCases),
    bundledCount: fixtureCases.length,
    capturedCount: 0,
    localPath: join(root, "cases.jsonl"),
  };
}

function calibrate(
  models: readonly string[] = ["local:capable", "local:quick-but-lost"],
  repeats = 3,
) {
  const goldenSet = fixtureGoldenSet();

  return runCalibration({
    models,
    repeats,
    staticPick: "local:capable",
    goldenSet,
    deps: {
      evidence,
      clock,
      random: createFixedRandom(),
      createModel: (modelSpec: string) => createScriptedModel(modelSpec, goldenSet.cases),
      commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
      probeMemory: () => Promise.resolve(null),
      scratchRoot: join(root, "scratch"),
      maxSteps: 6,
      abortSignal: new AbortController().signal,
    },
  });
}

describe("runCalibration against two local models", () => {
  it("runs every case against every model, the configured number of times", async () => {
    const result = await calibrate();

    expect(result.observations).toHaveLength(2 * 2 * 3);
    expect(result.models.map((model) => model.model)).toEqual([
      "local:capable",
      "local:quick-but-lost",
    ]);
  });

  it("measures the model that actually solves the cases as solving them", async () => {
    const result = await calibrate();
    const capable = result.models.find((model) => model.model === "local:capable");
    const lost = result.models.find((model) => model.model === "local:quick-but-lost");

    expect(capable?.dimensions["gate-pass"].mean).toBe(1);
    expect(lost?.dimensions["gate-pass"].mean).toBe(0);
  });

  it("reports a distribution per dimension rather than one number per model", async () => {
    const result = await calibrate();
    const capable = result.models.find((model) => model.model === "local:capable");

    expect(capable?.dimensions["tokens-per-second"].samples).toBe(6);
    expect(capable?.dimensions["time-to-first-token"].median).toBe(900);
    expect(capable?.dimensions["tool-call-validity"].samples).toBeGreaterThan(0);
  });

  it("picks the model the measurements support, not the faster one", async () => {
    const result = await calibrate();

    expect(result.pick.model).toBe("local:capable");
    expect(result.pick.reasoning.join(" ")).toMatch(/solved 1\.000 of the set/);
  });

  it("reports agreement with the static pick as corroboration", async () => {
    const result = await calibrate();

    expect(result.comparison.agrees).toBe(true);
    expect(result.comparison.statement).toMatch(/corroborates the shortlist/);
  });

  it("writes a summary record per model and a claim the harness evaluated", async () => {
    const result = await calibrate();

    expect(Object.keys(result.summaryRecords).sort()).toEqual([
      "local:capable",
      "local:quick-but-lost",
    ]);
    expect(result.claims.every((claim) => claim.verdict === "verified")).toBe(true);
  });

  it("clears every scratch workspace it made", async () => {
    await calibrate();

    expect(await readdir(join(root, "scratch")).catch(() => [])).toEqual([]);
  });

  it("exports a bundle whose own verifier passes with nothing installed", async () => {
    await calibrate(["local:capable"]);
    const destination = join(root, "bundle");

    await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination,
      signingKey: createEphemeralSigningKey(),
      clock,
    });

    const { stdout } = await run(process.execPath, [join(destination, "verify.mjs"), destination], {
      cwd: destination,
    });
    expect(stdout).toMatch(/OK|verified/i);

    const manifest = JSON.parse(await readFile(join(destination, "manifest.json"), "utf8"));
    expect(manifest.claims.unverified).toBe(0);
    expect(manifest.claims.verified).toBeGreaterThan(0);
  }, 60_000);

  it("names the golden set version it measured against", async () => {
    const result = await calibrate();

    expect(result.goldenSetVersion).toBe(fixtureGoldenSet().version);
    expect(result.cases).toBe(fixtureCases.length);
  });
});

/**
 * The two halves of one failure, kept apart because they fail differently. rapid-mlx serves
 * one model under a server-assigned alias; calibration was handed two local ids, every
 * dispatch for the one it was not holding was refused, and those refusals were recorded as
 * runs. The picker then read six "did not run" repeats as a 0.000 gate share, which is a
 * number, and preferred it to a model with real runs that fell under the validity floor.
 */
describe("a model the backend does not serve", () => {
  const served: ServedModelList = {
    endpoint: "http://127.0.0.1:8000/v1/models",
    enumerated: true,
    models: [{ id: "capable", root: null, parent: null }],
  };

  function preflight() {
    return preflightLocalModels({
      requested: ["local:capable", "local:never-served"],
      backendUrl: "http://127.0.0.1:8000/v1",
      list: served,
    });
  }

  it("is excluded from the run set before anything is dispatched", () => {
    expect(preflight().runnable).toEqual(["local:capable"]);
    expect(preflight().excluded).toEqual(["local:never-served"]);
  });

  it("leaves the exclusion in the ledger, and not one run record behind", async () => {
    const checked = preflight();
    await evidence.record(preflightRecord(checked));
    const result = await calibrate(checked.runnable, 1);

    const preflightRecords = evidence
      .records()
      .filter((record) => record.type === "calibration-preflight");
    expect(preflightRecords).toHaveLength(1);
    expect(evidence.payloads().get(preflightRecords[0]?.payloadDigest ?? "")).toMatchObject({
      backend: "http://127.0.0.1:8000/v1",
      served: ["capable"],
      excluded: ["local:never-served"],
    });

    const runs = evidence
      .records()
      .filter((record) => record.type === "calibration-run")
      .map((record) => evidence.payloads().get(record.payloadDigest));
    expect(runs).toHaveLength(fixtureCases.length);
    expect(runs.every((payload) => (payload as { model: string }).model === "local:capable")).toBe(
      true,
    );
    expect(result.models.map((model) => model.model)).toEqual(["local:capable"]);
  });
});

describe("a model whose every run failed to dispatch", () => {
  it("measures nothing on it rather than scoring it zero", async () => {
    const result = await calibrate(["local:never-served"], 1);
    const summary = result.models[0];

    expect(summary?.repeats).toBe(fixtureCases.length);
    expect(summary?.executedRepeats).toBe(0);
    expect(summary?.dimensions["gate-pass"]).toMatchObject({ samples: 0, mean: null });
    expect(summary?.dimensions["tool-call-validity"]).toMatchObject({ samples: 0, mean: null });
    expect(summary?.byCase.every((one) => one.didNotRun === one.repeats)).toBe(true);
  });

  it("is not a candidate, so it cannot win by being the last one standing", async () => {
    const result = await calibrate(["local:sloppy", "local:never-served"], 1);

    expect(result.pick.model).toBeNull();
    expect(result.pick.reasoning.join(" ")).toMatch(/no usable model/);
    expect(result.pick.rejected).toEqual([
      { model: "local:sloppy", reason: expect.stringMatching(/under the 0\.800/) },
      {
        model: "local:never-served",
        reason: expect.stringMatching(/0 of 2 run\(s\) executed/),
      },
    ]);
  });

  it("writes the abstain into the bundle as the verdict, not only into the report", async () => {
    const result = await calibrate(["local:sloppy", "local:never-served"], 1);

    expect(evidence.payloads().get(result.verdictRecord)).toMatchObject({
      pick: null,
      abstained: true,
      models: [
        { model: "local:sloppy", repeats: 2, executedRepeats: 2 },
        { model: "local:never-served", repeats: 2, executedRepeats: 0 },
      ],
    });
    expect(result.claims.at(-1)).toMatchObject({ verdict: "verified" });
  });

  it("does not report a divergence from a shortlist pick nothing measured", async () => {
    const goldenSet = fixtureGoldenSet();
    const result = await runCalibration({
      models: ["local:capable", "local:never-served"],
      repeats: 1,
      staticPick: "local:never-served",
      goldenSet,
      deps: {
        evidence,
        clock,
        random: createFixedRandom(),
        createModel: (modelSpec: string) => createScriptedModel(modelSpec, goldenSet.cases),
        commands: createNodeCommandRunner(clock, harnessChildEnvironment()),
        probeMemory: () => Promise.resolve(null),
        scratchRoot: join(root, "scratch"),
        maxSteps: 6,
        abortSignal: new AbortController().signal,
      },
    });

    expect(result.pick.model).toBe("local:capable");
    expect(result.comparison.statement).toMatch(/nothing measured to compare it against/);
  });
});
