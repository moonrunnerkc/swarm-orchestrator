import type { BundleManifest } from "./evidence/bundle-manifest.ts";
import type { EvidenceDag } from "./evidence/dag.ts";
import type { EvidenceSummary, RunFacts } from "./tui/evidence-panel.ts";
import { evidenceLocation } from "./tui/open-path.ts";
import { runEmbeddedVerifier } from "./tui/verify-bundle.ts";

/** How long the embedded verifier gets before the panel says it could not be asked. */
const verifyTimeoutMs = 60_000;

/**
 * What the run produced, with the bundle checked by its own verifier here rather than taken
 * on trust: the panel may say verified only where that ran in this session and exited zero.
 */
export async function summarizeEvidence(
  written: {
    readonly directory: string;
    readonly manifest: BundleManifest;
    readonly dag: EvidenceDag;
  },
  run?: RunFacts,
): Promise<EvidenceSummary> {
  const location = evidenceLocation(written.directory, "harness");
  return {
    location,
    ...(run === undefined ? {} : { run }),
    recordCount: written.manifest.recordCount,
    claimsVerified: written.dag.verifiedCount,
    claimsRefused: written.dag.unverifiedCount,
    verification: await runEmbeddedVerifier({
      location,
      nodeExecutable: process.execPath,
      environment: process.env,
      timeoutMs: verifyTimeoutMs,
    }),
  };
}
