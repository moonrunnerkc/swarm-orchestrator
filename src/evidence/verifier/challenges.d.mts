/** The per-requirement reading of recorded challenge observations, independently implemented. */
export function readChallengeOutcome(input: {
  requirement: { id: string; checks: readonly string[] };
  candidate: string;
  baseControl: string;
  alternatives: readonly unknown[];
}): {
  outcome: "detected" | "gap" | "invalid-evidence" | "unjudged" | "inapplicable";
  caught: string[];
  gaps: string[];
  unwitnessed: string[];
  invalid: string[];
};

/** Every challenge verdict on the chain, re-derived from its plan, runs and goal verifications. */
export function challengeVerdictsAgree(
  records: readonly { sequence: number; type: string; payloadDigest: string }[],
  payloads: ReadonlyMap<string, unknown>,
): readonly { sequence: number; agrees: boolean; problems: string[] }[];
