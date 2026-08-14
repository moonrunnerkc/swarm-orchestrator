import { z } from "zod";
import { digestPattern } from "../evidence/canonical-json.ts";
import { describeEvaluation } from "../evidence/claim.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";

const claimInput = z.object({
  predicate: z
    .string()
    .min(1)
    .describe(
      "A comparison over the cited record's payload, such as " +
        "facts.exitCode == 0 && facts.stdoutBytes > 0. Combine with && and ||.",
    ),
  record: z
    .string()
    .regex(digestPattern)
    .nullable()
    .describe(
      "The evidence record digest to check the predicate against, as reported in the " +
        "[evidence record sha256:... kind ...] trailer of a tool result. Null if there is none.",
    ),
  recordKind: z
    .string()
    .min(1)
    .describe(
      "What kind of record this claim is about, exactly as the trailer reported it, such as " +
        "tool-call:shell or gate-run:tests. A claim about the tests gate that cites the lint " +
        "gate's record renders UNVERIFIED rather than green.",
    ),
  narrative: z.string().optional().describe("Optional prose. Always shown as unverified."),
});

/**
 * How the model asserts something. It picks the predicate and the record; the harness
 * evaluates and returns its own verdict, so the model can under-claim but never over-claim
 * (invariant 1). Nothing here can produce a green result on its own: the returned verdict
 * is computed after the claim is on the ledger, and it is recomputed again at export and
 * once more by whoever verifies the bundle.
 */
export function createClaimTool(evidence: EvidenceRecorder, actor: string): ToolDefinition {
  return defineTool({
    name: "claim",
    description:
      "Assert a machine-checkable fact about a recorded evidence record. The harness " +
      "evaluates the predicate and returns the verdict; asserting something does not make it true.",
    inputSchema: claimInput,
    kind: "evidence",
    pathsFrom: () => [],
    async execute(input) {
      const evaluation = await evidence.submitClaim(
        {
          predicate: input.predicate,
          record: input.record,
          recordKind: input.recordKind,
          narrative: input.narrative ?? "",
        },
        actor,
      );
      return {
        text: `${describeEvaluation(evaluation)}: ${evaluation.detail}`,
        facts: {
          verdict: evaluation.verdict,
          reason: evaluation.reason ?? "none",
          predicate: input.predicate,
          recordKind: input.recordKind,
        },
      };
    },
  });
}
