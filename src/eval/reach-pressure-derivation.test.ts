import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import {
  assertOneAcquisition,
  type ExperimentIdentity,
  hiddenScoreSchema,
  MixedProtocolGenerations,
  manifestSchema,
  type ResultRow,
  resultRowSchema,
  summarize,
} from "./reach-pressure-analysis.ts";
import {
  derivationDestination,
  derivationRecord,
  identitySources,
  jsonDifference,
  PublishedSummaryWouldChange,
  scheduleOf,
} from "./reach-pressure-derivation.ts";

const evidence = join(
  import.meta.dirname,
  "../../docs/evidence/2026-09-17/reach-pressure-experiment",
);
const linesOf = (path: string): Record<string, unknown>[] =>
  readFileSync(join(evidence, path), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
const rawResultsOf = (path: string) =>
  linesOf(path).filter((row) => String(row.schema).endsWith("result.v1"));
const resultRowsOf = (path: string) => rawResultsOf(path).map((row) => resultRowSchema.parse(row));

const published = JSON.parse(readFileSync(join(evidence, "summary.json"), "utf8")) as {
  identity: ExperimentIdentity;
} & Record<string, unknown>;
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(join(evidence, "manifest.json"), "utf8")),
);
const generation3 = resultRowsOf("results.jsonl");
const hiddenScores = linesOf("hidden-scores.jsonl").map((row) => hiddenScoreSchema.parse(row));

const digests = {
  components: {
    acquisition: digestOfBytes("acquisition"),
    scoring: digestOfBytes("scoring"),
    analysis: digestOfBytes("analysis"),
    renderer: digestOfBytes("renderer"),
  },
  resultsDigest: digestOfBytes("results"),
  hiddenScoresDigest: digestOfBytes("scores"),
};

describe("generation 3, re-derived by the analysis as it stands today", () => {
  const summary = JSON.parse(
    JSON.stringify(
      summarize({
        manifest,
        identity: published.identity,
        results: generation3,
        hiddenScores,
      }),
    ),
  ) as Record<string, unknown>;
  const difference = jsonDifference(published, summary);

  it("changes no value the published summary carries, and removes none", () => {
    expect(difference.changed).toEqual(["/schema"]);
    expect(difference.removed).toEqual([]);
  });

  it("adds only accounting and repair-progress fields", () => {
    const families = new Set(difference.added.map((pointer) => pointer.replace(/\/\d+\//, "/N/")));
    expect([...families].sort()).toEqual([
      "/accounting/invocationsEndedOnProviderFailure",
      "/accounting/usage",
      "/secondary/overhead/prefix/accounting",
      "/secondary/overhead/reachRepair/accounting",
      "/secondary/repairOutcomes",
      "/triggered/N/overhead/accounting",
      "/triggered/N/repairOutcome",
      "/triggered/N/repairProgress",
      "/triggered/N/repairScope",
    ]);
  });

  it("is the same bytes twice", () => {
    const again = summarize({
      manifest,
      identity: published.identity,
      results: generation3,
      hiddenScores,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(summary));
  });

  it("splits 'repairs exhausted' into what the nine repairs did, from the rows alone", () => {
    expect((summary.secondary as { repairOutcomes: unknown }).repairOutcomes).toEqual({
      "findings-grew": 2,
      "findings-identical": 1,
      "patch-unchanged": 6,
    });
  });

  it("records that the numerical result did not change, and what was derived with what", () => {
    const record = derivationRecord({
      acquisition: published.identity,
      ...digests,
      driverSourcesDigest: digestOfBytes("sources as they stand now"),
      summary,
      summaryDigest: digestOfBytes(JSON.stringify(summary)),
      published: { summary: published, digest: digestOfBytes(JSON.stringify(published)) },
    });
    expect(record.acquisition).toEqual(published.identity);
    expect(record.derivation.matchesRegisteredDriver).toBe(false);
    expect(record.againstPublished).toMatchObject({
      identical: false,
      resultChanged: false,
      changed: ["/schema"],
      removed: [],
    });
    expect(record.historicalObservations.unchangedByThisDerivation).toContain("results.jsonl");
    expect(record.rederivedFields).toContain("primary");
  });
});

describe("rows of stopped generations cannot enter generation 3's estimate", () => {
  // Raw on purpose. Generation 1 predates fields today's row schema requires, and whose row it is
  // has to be answered before that matters.
  const generation1 = rawResultsOf("generation-1/results.jsonl") as unknown as ResultRow[];
  const generation2 = rawResultsOf("generation-2/results.jsonl") as unknown as ResultRow[];

  it("has rows of all three generations to mix, so the refusals below are not vacuous", () => {
    expect(new Set(generation1.map((row) => row.generation))).toEqual(new Set([1]));
    expect(new Set(generation2.map((row) => row.generation))).toEqual(new Set([2]));
    expect(generation3.length).toBeGreaterThan(70);
  });

  it.each([
    ["generation 1", () => generation1],
    ["generation 2", () => generation2],
  ])("refuses a results file that also holds %s", (_name, rows) => {
    expect(() =>
      summarize({
        manifest,
        identity: published.identity,
        results: [...generation3, ...rows()],
        hiddenScores,
      }),
    ).toThrow(MixedProtocolGenerations);
  });

  it("refuses them however few, wherever they sit", () => {
    const one = generation2.slice(0, 1);
    for (const results of [
      [...one, ...generation3],
      [...generation3.slice(0, 5), ...one, ...generation3.slice(5)],
    ]) {
      expect(() =>
        summarize({ manifest, identity: published.identity, results, hiddenScores }),
      ).toThrow(/generation 2/);
    }
  });

  it("refuses a held-back score produced under another generation", () => {
    const foreign = hiddenScores.map((score, at) =>
      at === 0 ? { ...score, generation: 2 } : score,
    );
    expect(() =>
      summarize({
        manifest,
        identity: published.identity,
        results: generation3,
        hiddenScores: foreign,
      }),
    ).toThrow(MixedProtocolGenerations);
  });

  it("refuses to run or score beside rows of another identity, before a task is spent", () => {
    expect(() => assertOneAcquisition(published.identity, generation3)).not.toThrow();
    expect(() =>
      assertOneAcquisition(published.identity, [...generation3, ...generation1]),
    ).toThrow(/generation 1 .*differs in generation, protocolDigest, driverDigest, harness/);
    // The shape a fourth generation would meet: generation 3's rows left in place.
    const next = { ...published.identity, generation: 4, protocolDigest: digestOfBytes("next") };
    expect(() => assertOneAcquisition(next, generation3)).toThrow(MixedProtocolGenerations);
  });

  it("refuses rows that differ only in the treatment or only in the driver", () => {
    const row = generation3[0];
    if (row === undefined) throw new Error("generation 3 has no rows");
    for (const field of ["policyDigest", "driverDigest", "manifestDigest"] as const) {
      expect(() =>
        assertOneAcquisition(published.identity, [{ ...row, [field]: digestOfBytes(field) }]),
      ).toThrow(new RegExp(`differs in ${field}`));
    }
  });
});

describe("a published derivation is never overwritten by different bytes", () => {
  const record = (publishedDigest: string | null, derived: Record<string, unknown>) =>
    derivationRecord({
      acquisition: published.identity,
      ...digests,
      driverSourcesDigest: published.identity.driverDigest,
      summary: derived,
      summaryDigest: digestOfBytes(JSON.stringify(derived)),
      published:
        publishedDigest === null ? null : { summary: { pairs: 79 }, digest: publishedDigest },
    });

  it("writes in place where nothing is published yet", () => {
    expect(
      derivationDestination({
        record: record(null, { pairs: 79 }),
        evidenceRoot: "/evidence",
        requestedOut: null,
      }),
    ).toBe("/evidence");
  });

  it("writes in place where it derives the bytes already there", () => {
    const same = record(digestOfBytes(JSON.stringify({ pairs: 79 })), { pairs: 79 });
    expect(same.againstPublished?.identical).toBe(true);
    expect(
      derivationDestination({ record: same, evidenceRoot: "/evidence", requestedOut: null }),
    ).toBe("/evidence");
  });

  it("refuses in place where a value moved, and says how to publish it beside the original", () => {
    const moved = record(digestOfBytes("the published bytes"), { pairs: 78 });
    expect(moved.againstPublished).toMatchObject({ resultChanged: true, changed: ["/pairs"] });
    expect(() =>
      derivationDestination({ record: moved, evidenceRoot: "/evidence", requestedOut: null }),
    ).toThrow(PublishedSummaryWouldChange);
    expect(
      derivationDestination({ record: moved, evidenceRoot: "/evidence", requestedOut: "/beside" }),
    ).toBe("/beside");
  });

  it("refuses in place where only fields were added, because the bytes still differ", () => {
    const grown = record(digestOfBytes("the published bytes"), { pairs: 79, usage: {} });
    expect(grown.againstPublished).toMatchObject({ resultChanged: false, added: ["/usage"] });
    expect(() =>
      derivationDestination({ record: grown, evidenceRoot: "/evidence", requestedOut: null }),
    ).toThrow(/not overwritten/);
  });
});

describe("the difference between two summaries", () => {
  it("names leaves, names a one-sided subtree once, and escapes pointer characters", () => {
    expect(
      jsonDifference(
        { a: { b: 1, c: [1, 2] }, gone: { deep: 1 }, "x/y": 1 },
        { a: { b: 2, c: [1, 3] }, fresh: { deep: 1 }, "x/y": 2 },
      ),
    ).toEqual({ changed: ["/a/b", "/a/c/1", "/x~1y"], added: ["/fresh"], removed: ["/gone"] });
  });

  it("reads null and a number as different, which is how an unknown total shows up", () => {
    expect(jsonDifference({ modelCalls: 769 }, { modelCalls: null }).changed).toEqual([
      "/modelCalls",
    ]);
  });
});

describe("each identity names sources that exist", () => {
  it.each(Object.entries(identitySources))("%s", (_component, sources) => {
    for (const source of sources) {
      expect(() => readFileSync(join(import.meta.dirname, "../..", source))).not.toThrow();
    }
    expect([...sources]).toEqual([...sources].sort());
  });

  it("keeps the renderer out of what decides a number", () => {
    expect(identitySources.analysis).not.toContain("src/eval/reach-pressure-report.ts");
    expect(identitySources.acquisition).not.toContain("src/eval/reach-pressure-report.ts");
  });
});

describe("resuming a run without repeating or losing an attempt", () => {
  const launch = (attempt: number) => ({ attempt, startedAt: `2026-09-18T00:0${attempt}:00Z` });
  const result = (status: string) => ({ trajectory: { status } });

  it("dispatches a task nobody has run", () => {
    expect(scheduleOf({ launches: [], results: [], attemptsPerTask: 3 })).toEqual({
      action: "dispatch",
      attempt: 1,
      closeDangling: null,
    });
  });

  it("never dispatches a settled task again", () => {
    for (const status of ["never-visible-accepted", "reach-repair-exhausted", "unjudgeable"]) {
      expect(
        scheduleOf({ launches: [launch(1)], results: [result(status)], attemptsPerTask: 3 }).action,
      ).toBe("settled");
    }
  });

  it("closes a launch the driver died under, then runs the next attempt number", () => {
    expect(scheduleOf({ launches: [launch(1)], results: [], attemptsPerTask: 3 })).toEqual({
      action: "dispatch",
      attempt: 2,
      closeDangling: { attempt: 1, startedAt: "2026-09-18T00:01:00Z" },
    });
  });

  it("reschedules an infrastructure failure under the next attempt number", () => {
    expect(
      scheduleOf({
        launches: [launch(1)],
        results: [result("infrastructure-failure")],
        attemptsPerTask: 3,
      }),
    ).toMatchObject({ action: "dispatch", attempt: 2, closeDangling: null });
  });

  it("stops rescheduling a task that keeps taking the server down, and still closes its launch", () => {
    const failed = result("infrastructure-failure");
    expect(
      scheduleOf({
        launches: [launch(1), launch(2), launch(3)],
        results: [failed, failed, failed],
        attemptsPerTask: 3,
      }),
    ).toEqual({ action: "exhausted", attempt: null, closeDangling: null });
    expect(
      scheduleOf({
        launches: [launch(1), launch(2), launch(3)],
        results: [failed, failed],
        attemptsPerTask: 3,
      }),
    ).toMatchObject({ action: "exhausted", closeDangling: { attempt: 3 } });
  });
});
