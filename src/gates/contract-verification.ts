import { z } from "zod";
import {
  type AcceptanceContract,
  freezeAcceptanceContract,
} from "../evidence/acceptance-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

export const requirementObservationSchema = z.object({
  status: z.enum(["passed", "assertion-failed", "unavailable"]),
  evidenceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
});
export type RequirementObservation = z.infer<typeof requirementObservationSchema>;
export interface ContractVerification {
  readonly policy: "required-obligations-v1";
  readonly contractDigest: string;
  readonly accepted: boolean;
  readonly obligations: readonly {
    id: string;
    severity: "required" | "advisory";
    status: "accepted" | "rejected" | "unjudged" | "not-applicable";
    observations: readonly RequirementObservation[];
  }[];
}

/** The executor supplies harness observations from separate trusted control and candidate checkouts. */
export async function verifyAcceptanceContract(
  input: unknown,
  options: {
    evidence: EvidenceRecorder;
    execute: (
      requirement: AcceptanceContract["requirements"][number],
      target: "reference" | "violating-control" | "candidate",
    ) => Promise<RequirementObservation>;
  },
): Promise<ContractVerification> {
  const frozen = freezeAcceptanceContract(input);
  await options.evidence.record({
    type: "acceptance-contract",
    actor: "harness",
    provenance: ["user"],
    payload: frozen,
  });
  const obligations: ContractVerification["obligations"][number][] = [];
  for (const requirement of frozen.contract.requirements) {
    const observations: RequirementObservation[] = [];
    if (requirement.applicable) {
      for (const target of ["reference", "violating-control", "candidate"] as const) {
        observations.push(
          requirementObservationSchema.parse(await options.execute(requirement, target)),
        );
      }
    }
    const instrument =
      observations[0]?.status === "passed" && observations[1]?.status === "assertion-failed";
    const status = !requirement.applicable
      ? "not-applicable"
      : !instrument || observations[2]?.status === "unavailable"
        ? "unjudged"
        : observations[2]?.status === "passed"
          ? "accepted"
          : "rejected";
    obligations.push({ id: requirement.id, severity: requirement.severity, status, observations });
  }
  const accepted = obligations.every(
    (obligation) =>
      obligation.severity !== "required" ||
      obligation.status === "accepted" ||
      obligation.status === "not-applicable",
  );
  const verification: ContractVerification = {
    policy: "required-obligations-v1",
    contractDigest: frozen.digest,
    accepted,
    obligations,
  };
  await options.evidence.record({
    type: "contract-verification",
    actor: "harness",
    provenance: ["tool-output"],
    payload: JSON.parse(JSON.stringify(verification)),
  });
  return verification;
}
