import type { EvidenceRecorder } from "../evidence/session.ts";
import type { ExecutionEnvelope } from "./execution-mode.ts";

/**
 * The envelope goes on the chain, so what a run executed under is a record rather than
 * something the CLI printed. The probes travel with it: a verdict nobody can check is exactly
 * what this replaces, and a reader opening a bundle months later needs to see which escapes
 * were tried and which got through, not the word the harness chose for the result.
 */
export async function recordExecutionEnvelope(
  evidence: EvidenceRecorder,
  envelope: ExecutionEnvelope,
): Promise<void> {
  await evidence.record({
    type: "execution-envelope",
    actor: "harness",
    provenance: ["tool-output"],
    payload: {
      mode: envelope.mode,
      backend: envelope.backend,
      writablePaths: [...envelope.writablePaths],
      readOnlyPaths: [...envelope.readOnlyPaths],
      network: envelope.network,
      environmentPolicy: envelope.environmentPolicy,
      credentialNamesWithheld: envelope.credentialNamesWithheld,
      repositoryConfigTrusted: envelope.repositoryConfigTrusted,
      probes: envelope.probes.map((probe) => ({
        id: probe.id,
        attempted: probe.attempted,
        contained: probe.contained,
        observed: probe.observed,
      })),
      summary: envelope.summary,
    },
  });
}
