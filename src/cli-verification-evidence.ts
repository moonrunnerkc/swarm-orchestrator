import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createSystemRandom } from "./cli-runtime-inputs.ts";
import type { Clock } from "./core/clock.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import {
  createSessionId,
  defaultSessionRoot,
  type EvidenceRecorder,
  openEvidenceSession,
} from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";

/** Export partial evidence for setup failures as well as completed assessments. */
export async function withVerificationEvidence(
  clock: Clock,
  destination: string | undefined,
  run: (
    evidence: EvidenceRecorder,
    bundleDirectory: string,
    exportEvidence: () => Promise<void>,
  ) => Promise<number>,
): Promise<number> {
  const evidence = await openEvidenceSession({
    root: defaultSessionRoot(homedir()),
    sessionId: createSessionId(clock, createSystemRandom()),
    clock,
  });
  const bundleDirectory = destination ?? join(evidence.directory, "bundle");
  let exported = false;
  const exportEvidence = async (): Promise<void> => {
    if (exported) return;
    const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
    if (signing.notice !== null) process.stderr.write(`[signing] ${signing.notice}\n`);
    const bundle = await exportBundle({
      source: bundleSourceFromRecorder(evidence),
      destination: bundleDirectory,
      signingKey: signing.key,
      clock,
    });
    exported = true;
    process.stderr.write(`verification evidence: ${bundle.directory}\n`);
  };
  try {
    return await run(evidence, bundleDirectory, exportEvidence);
  } catch (cause) {
    if (!exported)
      await evidence.record({
        type: "session-stopped",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          stopReason: "verification-error",
          detail: cause instanceof Error ? cause.message : String(cause),
        },
      });
    throw cause;
  } finally {
    await exportEvidence();
  }
}
