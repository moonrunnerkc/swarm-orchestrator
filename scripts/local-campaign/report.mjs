import { z } from "zod";
import { wilsonInterval } from "../../src/eval/statistics.ts";

const rowSchema = z
  .object({
    runId: z.string(),
    caseId: z.string(),
    arm: z.string(),
    status: z.enum(["completed", "failed"]),
    heldBackAccepted: z.boolean().nullable(),
    certified: z.boolean().nullable(),
    totalMs: z.number().nonnegative(),
    tokens: z.number().nonnegative().nullable(),
    cleanup: z.enum(["confirmed", "failed", "unmeasured"]),
  })
  .passthrough();

export function selectBaseline(input) {
  const rows = z.array(rowSchema).parse(input);
  const arms = ["direct-once", "direct-feedback"].map((arm, order) => {
    const selected = rows.filter((row) => row.arm === arm);
    return {
      arm,
      order,
      launched: selected.length,
      accepted: selected.filter(
        (row) => row.heldBackAccepted === true && row.acceptedWithinBudget !== false,
      ).length,
      latencyMs: selected.reduce((sum, row) => sum + row.totalMs, 0),
    };
  });
  if (!arms[0].launched || arms[0].launched !== arms[1].launched)
    throw new Error("baseline selection needs the complete matched practice schedule");
  const identities = arms.map(({ arm }) =>
    rows
      .filter((row) => row.arm === arm)
      .map((row) => row.caseId)
      .sort(),
  );
  if (
    JSON.stringify(identities[0]) !== JSON.stringify(identities[1]) ||
    new Set(identities[0]).size !== identities[0].length
  )
    throw new Error("baseline practice cases are mismatched or duplicated");
  arms.sort(
    (left, right) =>
      right.accepted - left.accepted ||
      left.latencyMs - right.latencyMs ||
      left.order - right.order,
  );
  return {
    selected: arms[0].arm,
    candidates: arms,
    claim: "strongest of these two local configurations on this practice set only",
  };
}

export function summarizeCampaign(input, schedule) {
  const rows = z.array(rowSchema).parse(input);
  const ids = new Set(rows.map((row) => row.runId));
  if (
    ids.size !== rows.length ||
    rows.some(
      (row) =>
        !schedule.some(
          (entry) =>
            entry.runId === row.runId && entry.caseId === row.caseId && entry.arm === row.arm,
        ),
    )
  )
    throw new Error("campaign contains duplicate or unplanned outcomes");
  const baseline = schedule.find((entry) => entry.arm !== "swarm")?.arm;
  const pairs = [...new Set(schedule.map((entry) => entry.caseId))].map((caseId) => {
    const candidate = rows.find((row) => row.caseId === caseId && row.arm === "swarm");
    const comparison = rows.find((row) => row.caseId === caseId && row.arm === baseline);
    const left =
      comparison?.heldBackAccepted == null
        ? null
        : (comparison.acceptedWithinBudget ?? comparison.heldBackAccepted);
    const right =
      candidate?.heldBackAccepted == null
        ? null
        : (candidate.acceptedWithinBudget ?? candidate.heldBackAccepted);
    return {
      caseId,
      baseline: left ?? null,
      candidate: right ?? null,
      outcome:
        left == null || right == null
          ? "unknown"
          : left && right
            ? "both-accepted"
            : right
              ? "candidate-only"
              : left
                ? "baseline-only"
                : "neither-accepted",
    };
  });
  return {
    planned: schedule.length,
    settled: rows.length,
    missing: schedule.filter((entry) => !ids.has(entry.runId)),
    population: "model-authored synthetic fixtures, not independent real-world repositories",
    confirmatory: false,
    pairedComparison: { baseline: baseline ?? null, pairs, nonInferiorityEstablished: false },
    arms: [...new Set(schedule.map((entry) => entry.arm))].map((arm) => {
      const selected = rows.filter((row) => row.arm === arm);
      const certified = selected.filter((row) => row.certified === true);
      const judgedCertified = certified.filter((row) => row.heldBackAccepted !== null);
      const falseGreens = judgedCertified.filter((row) => row.heldBackAccepted === false).length;
      const stops = new Map();
      for (const row of selected) {
        const reason = row.stopReason ?? "unspecified";
        stops.set(reason, (stops.get(reason) ?? 0) + 1);
      }
      return {
        arm,
        launched: selected.length,
        failed: selected.filter((row) => row.status === "failed").length,
        stopReasons: Object.fromEntries(stops),
        accepted: selected.filter((row) => row.heldBackAccepted === true).length,
        acceptedWithinBudget: selected.filter(
          (row) => row.heldBackAccepted === true && row.acceptedWithinBudget !== false,
        ).length,
        certified: certified.length,
        falseGreens,
        certifiedUnjudged: certified.length - judgedCertified.length,
        unknown: selected.filter((row) => row.heldBackAccepted === null || row.certified === null)
          .length,
        illustrativeWilson: judgedCertified.length
          ? wilsonInterval(falseGreens, judgedCertified.length)
          : null,
        intervalLimitation:
          "descriptive binomial calculation only; convenience fixtures do not establish independent population sampling",
        totalMs: selected.reduce((sum, row) => sum + row.totalMs, 0),
        tokens: selected.every((row) => row.tokens !== null)
          ? selected.reduce((sum, row) => sum + row.tokens, 0)
          : null,
        costUsd: null,
      };
    }),
  };
}
