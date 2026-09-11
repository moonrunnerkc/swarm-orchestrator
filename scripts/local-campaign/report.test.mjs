import { expect, it } from "vitest";
import { selectBaseline, summarizeCampaign } from "./report.mjs";

function row(arm, fields = {}) {
  return {
    runId: arm,
    caseId: "one",
    arm,
    status: "completed",
    heldBackAccepted: true,
    certified: true,
    totalMs: 10,
    tokens: 20,
    cleanup: "confirmed",
    ...fields,
  };
}
it("selects correctness before latency and requires matched practice cases", () => {
  expect(
    selectBaseline([
      row("direct-once", { heldBackAccepted: false }),
      row("direct-feedback", { totalMs: 100 }),
    ]).selected,
  ).toBe("direct-feedback");
  expect(() =>
    selectBaseline([row("direct-once"), row("direct-feedback", { caseId: "different" })]),
  ).toThrow();
});
it("retains unknown certified outcomes beside false greens and never claims confirmation", () => {
  const rows = [row("one", { heldBackAccepted: false }), row("two", { heldBackAccepted: null })];
  const report = summarizeCampaign(rows, rows);
  expect(report.confirmatory).toBe(false);
  expect(report.arms[0].falseGreens).toBe(1);
  expect(report.arms[1].certifiedUnjudged).toBe(1);
  expect(report.arms[1].illustrativeWilson).toBeNull();
});
it("rejects duplicate observations and exposes unfinished schedules", () => {
  const one = row("one");
  expect(() => summarizeCampaign([one, one], [one])).toThrow();
  expect(summarizeCampaign([], [one]).missing).toHaveLength(1);
});

it("keeps an unavailable paired outcome distinct from both tools failing", () => {
  const rows = [row("direct-once"), row("swarm", { heldBackAccepted: null })];
  const paired = summarizeCampaign(rows, rows).pairedComparison;
  expect(paired.pairs[0].outcome).toBe("unknown");
  expect(paired.nonInferiorityEstablished).toBe(false);
});
