import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { distribution, readCalibrationRuns, render, summarize } from "./compare-calibrations.mjs";

const repositoryRoot = join(import.meta.dirname, "..");
const committedSweep = join(repositoryRoot, "docs", "evidence", "2026-08-23", "calibration");

function run(overrides) {
  return {
    model: "local:a",
    caseId: "case-1",
    taskClass: "edit",
    executed: true,
    gatePassed: true,
    tokensPerSecond: 50,
    firstTokenMs: 400,
    steps: 4,
    responseTimeMs: 20000,
    ...overrides,
  };
}

describe("a distribution", () => {
  it("is quantiles over finite values, and nothing over nothing", () => {
    expect(distribution([3, 1, 2, null, Number.NaN])).toEqual({
      count: 3,
      minimum: 1,
      quartile1: 2,
      median: 2,
      quartile3: 3,
      maximum: 3,
    });
    expect(distribution([]).count).toBe(0);
  });
});

describe("summarizing runs", () => {
  it("measures executed repeats only, and counts the rest as attempted", () => {
    const summaries = summarize([
      run({}),
      run({ gatePassed: false, tokensPerSecond: 70 }),
      run({ executed: false, tokensPerSecond: 1000 }),
      run({ model: "local:b", caseId: "case-2" }),
    ]);

    expect(summaries["local:a"].attempted).toBe(3);
    expect(summaries["local:a"].executed).toBe(2);
    expect(summaries["local:a"].dimensions.tokensPerSecond).toMatchObject({ count: 2, minimum: 50, maximum: 70 });
    expect(summaries["local:a"].dimensions.gatePassed.median).toBe(1);
    expect(summaries["local:a"].cases["case-1"]).toEqual({ taskClass: "edit", green: 1, executed: 2 });
    expect(summaries["local:b"].executed).toBe(1);
  });
});

describe("rendering two sweeps side by side", () => {
  it("puts each bundle's row under the same dimension, and green per case per bundle", () => {
    const first = summarize([run({}), run({ gatePassed: false })]);
    const second = summarize([run({ tokensPerSecond: 90 })]);

    const page = render([
      { label: "first", summaries: first },
      { label: "second", summaries: second },
    ]);

    expect(page).toContain("## local:a");
    expect(page).toContain("| output tokens per second | first | 2 |");
    expect(page).toContain("| output tokens per second | second | 1 | 90.0 |");
    expect(page).toContain("| case-1 | edit | 1 of 2 | 1 of 1 |");
    expect(page).toContain("first: 2 of 2 repeats executed");
  });
});

describe("over the committed sweep", () => {
  it("reads every calibration-run record the 08-23 bundle carries", () => {
    const runs = readCalibrationRuns(committedSweep);
    const summaries = summarize(runs);

    expect(runs).toHaveLength(180);
    expect(Object.keys(summaries).sort()).toEqual(["local:gemma4:31b", "local:qwen3.5:27b", "local:qwen3.6:35b-a3b"]);
    expect(summaries["local:qwen3.6:35b-a3b"].executed).toBe(59);
  });
});
