import { describe, expect, it } from "vitest";
import { distribution, renderReport, summarizeArm } from "./report.mjs";

function result(overrides) {
  return {
    language: "Go",
    executed: true,
    timedOut: false,
    durationMs: 120000,
    outcome: "fixed-by-restoring-the-line",
    bundle: {
      verified: true,
      records: 40,
      settledGreen: true,
      escalations: [],
      ratchetRejections: 0,
      claims: { verified: 1, unverified: 0 },
    },
    ...overrides,
  };
}

describe("a distribution", () => {
  it("reports quantiles rather than an average, and nothing over nothing", () => {
    expect(distribution([5, 1, 3, 4, 2])).toEqual({ count: 5, minimum: 1, quartile1: 2, median: 3, quartile3: 4, maximum: 5 });
    expect(distribution([]).count).toBe(0);
    expect(distribution([]).median).toBeNull();
  });
});

describe("summarizing an arm", () => {
  it("counts executed runs only, and names the rest beside them", () => {
    const summary = summarizeArm([
      result({}),
      result({ outcome: "not-fixed", bundle: { ...result({}).bundle, settledGreen: false, escalations: [{ gateId: "tests" }], ratchetRejections: 2, claims: { verified: 0, unverified: 1 } } }),
      result({ executed: false, outcome: "not-executed" }),
      result({ executed: false, bundle: null, outcome: "no-bundle", timedOut: true }),
    ]);

    expect(summary.runs).toBe(4);
    expect(summary.executed).toBe(2);
    expect(summary.notExecuted).toBe(1);
    expect(summary.noBundle).toBe(1);
    expect(summary.timedOut).toBe(1);
    expect(summary.bundlesVerified).toBe(3);
    expect(summary.outcomes).toEqual({ "fixed-by-restoring-the-line": 1, "not-fixed": 1 });
    expect(summary.settledGreen).toBe(1);
    expect(summary.escalated).toBe(1);
    expect(summary.ratchetRejections).toBe(2);
    expect(summary.claims).toEqual({ verified: 1, unverified: 1 });
    expect(summary.durationMinutes.count).toBe(2);
  });
});

describe("rendering the report", () => {
  it("writes one table per arm and says not measured where nothing executed", () => {
    const page = renderReport(
      { "local-mlx": summarizeArm([result({})]), frontier: summarizeArm([]) },
      { generatedAt: "2026-09-02T00:00:00Z", notes: ["frontier: NOT-DONE, the key has no balance"] },
    );

    expect(page).toContain("## local-mlx");
    expect(page).toContain("| executed | 1 |");
    expect(page).toContain("| duration | min 2.0, q1 2.0, median 2.0, q3 2.0, max 2.0 min over 1 |");
    expect(page).toContain("## frontier");
    expect(page).toContain("| duration | not measured: no executed run |");
    expect(page).toContain("- frontier: NOT-DONE, the key has no balance");
  });
});

describe("which CLI an arm measured", () => {
  const digest = "b".repeat(64);

  it("is read from the records, one digest expected, none reported as not recorded, several as mixed", () => {
    expect(summarizeArm([result({ cli: { tarballSha256: digest } }), result({ cli: { tarballSha256: digest } })]).cliTarballDigests).toEqual([digest]);
    expect(summarizeArm([result({})]).cliTarballDigests).toEqual([]);
    expect(summarizeArm([result({ cli: { tarballSha256: null, reason: "no label" } })]).cliTarballDigests).toEqual([]);

    const mixed = renderReport({ arm: summarizeArm([result({ cli: { tarballSha256: digest } }), result({ cli: { tarballSha256: "c".repeat(64) } })]) }, { generatedAt: "t" });
    expect(mixed).toContain("MIXED, 2 digests");
    const unlabelled = renderReport({ arm: summarizeArm([result({})]) }, { generatedAt: "t" });
    expect(unlabelled).toContain("not recorded: the images these runs used carried no CLI tarball label");
    expect(renderReport({ frontier: summarizeArm([]) }, { generatedAt: "t" })).toContain("| CLI tarball the runs' images carried | no run recorded |");
  });

  it("names the campaign and the CLI it was packed from at the top, where the campaign is named", () => {
    const page = renderReport(
      { arm: summarizeArm([result({ cli: { tarballSha256: digest } })]) },
      { generatedAt: "t", campaign: "fixed-cli", cli: { tarball: "swarm-orchestrator-13.1.9.tgz", tarballSha256: digest, packedFromCommit: "abc1234", packedAt: "2026-09-04T10:00:00Z" } },
    );

    expect(page.startsWith("# Campaign results: `fixed-cli`")).toBe(true);
    expect(page).toContain("packed from commit `abc1234` at 2026-09-04T10:00:00Z");
    expect(page).toContain(`| CLI tarball the runs' images carried | sha256:${digest} |`);
    expect(renderReport({}, { generatedAt: "t" }).startsWith("# Campaign results\n")).toBe(true);
  });
});

