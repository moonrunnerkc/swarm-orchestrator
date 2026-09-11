import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { CampaignProtocol } from "./protocol.ts";

export function campaignProtocolFixture(): CampaignProtocol {
  const digest = digestOfBytes("fixture");
  return {
    version: 1,
    population: "fixture repositories",
    samplingUnit: "independent-repository",
    exposure: "held-out",
    stratum: "ordinary",
    cases: [
      {
        id: "one",
        repository: "repo-one",
        baseCommit: "abc",
        oracleDigest: digest,
        heldBackDigest: digest,
        sourceDigest: digest,
      },
    ],
    arms: ["baseline", "candidate"].map((id) => ({
      id,
      implementationDigest: digest,
      model: "fixture",
      backendDigest: digest,
    })),
    verifierDigest: digest,
    budgets: { tokens: 100, wallMs: 1000 },
    seeds: [0],
    order: "counterbalanced",
    stopping: "fixed-schedule",
    failureDisposition: "retain-all-launched",
    baseline: "baseline",
    baselineSelectionDigest: digest,
    margin: 0.05,
    targetUpperBound: 0.05,
    interval: "paired-hoeffding-95",
  };
}
