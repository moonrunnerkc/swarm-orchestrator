import { z } from "zod";
import { digestOfJson } from "../../src/evidence/canonical-json.ts";
import { parseUnifiedDiff } from "../../src/gates/unified-diff.ts";

export const crossoverRubric = {
  version: 1,
  scope: "Exploratory D6 analysis, separate from the frozen primary pilot analysis.",
  tiny: "At most 20 added plus removed production lines in exactly one production file.",
  singleFile: "Exactly one production file in the normalized historical reference patch.",
  production:
    "JavaScript, TypeScript and Python source or public declarations, excluding test files, test directories, helpers, examples, typing examples, benchmarks and documentation.",
  coupled: {
    "tj-commander-js-1678":
      "Option conflict metadata, command validation and public types must agree.",
    "tj-commander-js-2006":
      "Command and Help share the same help Option object and its configuration.",
    "gvergnaud-ts-pattern-253": "The exhaustive fallback runtime and public overloads must agree.",
    "python-attrs-attrs-4b5b295b":
      "Generator hook setup and assignment must preserve the same before/after lifecycle.",
  },
  decision:
    "Compare paired goals. Known complete-goal acceptance takes precedence. For two accepted goals, require time and reported-token dominance with at least one strict improvement. Neither accepted, infrastructure errors, missing judgments or usage do not establish a crossover.",
  limitation:
    "Groups overlap, coupled cases are explicitly selected, and each goal has one attempt per arm. No universal threshold, independent replication or additional statistical confidence is inferred.",
};

export function classifyCrossoverGoals(input) {
  const candidates = z.array(z.object({ id: z.string(), referencePatch: z.string() })).parse(input);
  return candidates.map((candidate) => {
    const couplingReason = Object.hasOwn(crossoverRubric.coupled, candidate.id)
      ? crossoverRubric.coupled[candidate.id]
      : null;
    const production = parseUnifiedDiff(candidate.referencePatch).filter(
      (file) =>
        /\.(?:[cm]?js|tsx?|pyi?)$/.test(file.path) &&
        !/(^|\/)(?:tests?|__tests__|test-helpers|docs|examples|typing-examples|benchmarks)(\/|\.)|\.(?:test|spec)[.-]/.test(
          file.path,
        ),
    );
    const lines = production.reduce(
      (total, file) => total + file.addedLines.length + file.removedLines.length,
      0,
    );
    return {
      caseId: candidate.id,
      productionFiles: production.map((file) => file.path),
      productionChangedLines: lines,
      groups: [
        ...(production.length === 1 && lines <= 20 ? ["tiny"] : []),
        ...(production.length === 1 ? ["single-file"] : []),
        ...(couplingReason === null ? [] : ["coupled"]),
      ],
      couplingReason,
    };
  });
}

export function compareWorkerPair(single, parallel) {
  const known = (slot) =>
    slot?.outcome !== null &&
    slot?.outcome !== undefined &&
    slot.outcome.status !== "infrastructure-failure" &&
    typeof slot.outcome.certified === "boolean" &&
    typeof slot.outcome.heldBackAccepted === "boolean";
  if (!known(single) || !known(parallel)) return "unknown-judgment";
  const accepted = (slot) => slot.outcome.certified && slot.outcome.heldBackAccepted;
  if (accepted(single) !== accepted(parallel))
    return accepted(single) ? "single-only-accepted" : "parallel-only-accepted";
  if (!accepted(single)) return "neither-accepted";
  const tokens = (slot) => {
    const metrics = slot.outcome.goal;
    return metrics?.inputTokens == null ||
      metrics?.outputTokens == null ||
      metrics.unknownCalls !== 0 ||
      metrics.reservedTokens !== 0
      ? null
      : metrics.inputTokens + metrics.outputTokens;
  };
  const left = tokens(single),
    right = tokens(parallel);
  if (
    left === null ||
    right === null ||
    single.executionWallMs === null ||
    parallel.executionWallMs === null
  )
    return "unknown-resources";
  const time = single.executionWallMs - parallel.executionWallMs;
  const usage = left - right;
  if (time === 0 && usage === 0) return "tie";
  if (time <= 0 && usage <= 0) return "single-dominates";
  if (time >= 0 && usage >= 0) return "parallel-dominates";
  return "tradeoff";
}

export function summarizeCrossover(candidates, slots, arms) {
  const identities = slots.map((slot) => JSON.stringify([slot.caseId, slot.armId]));
  if (new Set(identities).size !== identities.length)
    throw new Error("Crossover repeats require a declared aggregation; do not select one attempt");
  const goals = classifyCrossoverGoals(candidates);
  const pairs = goals.flatMap((goal) => {
    const single = slots.find((slot) => slot.caseId === goal.caseId && slot.armId === "single");
    return arms
      .filter((arm) => arm.id !== "single")
      .map((arm) => {
        const parallel = slots.find((slot) => slot.caseId === goal.caseId && slot.armId === arm.id);
        return {
          caseId: goal.caseId,
          armId: arm.id,
          groups: goal.groups,
          decision: compareWorkerPair(single, parallel),
        };
      });
  });
  return {
    rubric: crossoverRubric,
    rubricDigest: digestOfJson(crossoverRubric),
    goals,
    pairs,
    groups: ["tiny", "single-file", "coupled"].map((group) => ({
      group,
      goals: goals.filter((goal) => goal.groups.includes(group)).length,
      arms: arms
        .filter((arm) => arm.id !== "single")
        .map((arm) => {
          const rows = pairs.filter((pair) => pair.armId === arm.id && pair.groups.includes(group));
          return {
            armId: arm.id,
            goalPairs: rows.length,
            decisions: Object.fromEntries(
              [...new Set(rows.map((row) => row.decision))]
                .sort()
                .map((decision) => [
                  decision,
                  rows.filter((row) => row.decision === decision).length,
                ]),
            ),
          };
        }),
    })),
  };
}
