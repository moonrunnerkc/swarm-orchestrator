import { z } from "zod";
import type { JsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { DiffBudget, GateDefinition } from "./gate-definition.ts";
import type { ProjectDetection } from "./project-type.ts";

/**
 * The criteria a run is measured by, written to the chain before the model is asked for
 * anything. A gate set assembled after the loop describes what was measured; one sealed
 * before it describes what the run agreed to be measured by, and the difference is whether a
 * run can loosen its own criteria on the way. The embedded verifier holds every gate-run
 * record to this one: a gate it does not name, a severity it did not declare, or a blocking
 * gate that never ran in the final attempt is a bundle that measured something other than
 * what it promised.
 */
export const gateSetSealSchema = z.object({
  detectedTypes: z.array(z.string()),
  gates: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.enum(["blocking", "advisory"]),
      source: z.enum(["command", "inspection"]),
      /** How the run reads to a person, for a command; null for an inspection. */
      command: z.string().nullable(),
      parser: z.enum(["exit-code", "no-output", "test-output", "inspection"]),
    }),
  ),
  budgets: z.object({ maxChangedFiles: z.number(), maxAddedLines: z.number() }),
  attemptCap: z.number(),
  /** The measures the ratchet holds, by name, so an arm cannot be dropped after the fact. */
  ratchetArms: z.array(z.string()),
});

export type GateSetSeal = z.infer<typeof gateSetSealSchema>;

export const ratchetArmNames = [
  "gate-regressed",
  "testsDeclared",
  "assertions",
  "skipMarkers",
  "testsCollected",
  "changedLineCoverage",
] as const;

export function describeGateSet(input: {
  readonly detection: ProjectDetection;
  readonly gates: readonly GateDefinition[];
  readonly budgets: DiffBudget;
  readonly attemptCap: number;
}): GateSetSeal {
  return gateSetSealSchema.parse({
    detectedTypes: [...input.detection.types],
    gates: input.gates.map((gate) => ({
      id: gate.id,
      title: gate.title,
      severity: gate.severity,
      source: gate.source.kind,
      command: gate.source.kind === "command" ? gate.source.command : null,
      parser: gate.parserName ?? "exit-code",
    })),
    budgets: { ...input.budgets },
    attemptCap: input.attemptCap,
    ratchetArms: [...ratchetArmNames],
  });
}

export async function sealGateSet(
  evidence: EvidenceRecorder,
  seal: GateSetSeal,
): Promise<{ readonly digest: string }> {
  const recorded = await evidence.record({
    type: "gate-set-sealed",
    actor: "harness",
    provenance: ["user"],
    payload: seal as unknown as JsonValue,
  });
  return { digest: recorded.record.payloadDigest };
}
