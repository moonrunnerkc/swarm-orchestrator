import { platform } from "node:os";
import { join } from "node:path";
import { buildVersion } from "./build-version.ts";
import type { Clock } from "./core/clock.ts";
import { buildAttestation, signAttestation } from "./evidence/attestation.ts";
import { bundleSourceFromRecorder, exportBundle } from "./evidence/bundle.ts";
import type { BundleManifest } from "./evidence/bundle-manifest.ts";
import { digestOfBytes } from "./evidence/canonical-json.ts";
import type { EvidenceDag } from "./evidence/dag.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { createKeychainSecretStore, resolveSigningKey } from "./evidence/signing.ts";
import type { EvidenceSummary } from "./tui/evidence-panel.ts";
import { evidenceLocation } from "./tui/open-path.ts";
import { runEmbeddedVerifier } from "./tui/verify-bundle.ts";

/** How long the embedded verifier gets before the panel says it could not be asked. */
const verifyTimeoutMs = 60_000;

/**
 * What the run produced, with the bundle checked by its own verifier here rather than taken
 * on trust: the panel may say verified only where that ran in this session and exited zero.
 */
export async function summarizeEvidence(written: {
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly dag: EvidenceDag;
}): Promise<EvidenceSummary> {
  const location = evidenceLocation(written.directory, "harness");
  return {
    location,
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

export function announceBundle(directory: string, note: (line: string) => void = writeOut): void {
  note(`\nevidence bundle: ${directory}`);
  note(`verify it anywhere: node ${join(directory, "verify.mjs")} ${directory}`);
  note(`review it: open ${join(directory, "review.html")}`);
}

export async function writeBundle(
  evidence: EvidenceRecorder,
  destination: string | null,
  clock: Clock,
  note: (line: string) => void = writeOut,
  attested?: {
    readonly verdict: Readonly<Record<string, unknown>>;
    readonly executionMode: string;
  },
): Promise<{
  readonly directory: string;
  readonly manifest: BundleManifest;
  readonly dag: EvidenceDag;
}> {
  const signing = await resolveSigningKey(createKeychainSecretStore({ platform: platform() }));
  if (signing.notice !== null) {
    note(`[signing] ${signing.notice}`);
  }
  const directory = destination ?? join(evidence.directory, "bundle");
  const patch = recordedField(evidence, "workspace-diff", "patch");
  const patchDigest = recordedField(evidence, "workspace-diff", "rawPatchDigest");
  const patchBound = patch !== null && patchDigest === digestOfBytes(patch);
  if (attested !== undefined && !patchBound)
    note(
      "[attestation] raw patch binding is unavailable; the evidence bundle remains independently verifiable",
    );
  const attestation =
    attested === undefined || !patchBound || recordedDigest(evidence, "run-spec-sealed") === null
      ? undefined
      : signAttestation(
          buildAttestation({
            runId: evidence.sessionId,
            specDigest: recordedDigest(evidence, "run-spec-sealed") ?? "sha256:unsealed",
            sourceCommit: recordedSpecBase(evidence),
            patchDigest: patchDigest as string,
            chainHead: evidence.head().hash,
            toolVersion: buildVersion,
            executionMode: attested.executionMode,
            verdict: attested.verdict,
          }),
          signing.key,
        );
  const written = await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination: directory,
    signingKey: signing.key,
    clock,
    ...(attestation === undefined ? {} : { attestation }),
  });
  return { directory, manifest: written.manifest, dag: written.dag };
}

function recordedSpecBase(evidence: EvidenceRecorder): string {
  const digest = recordedDigest(evidence, "run-spec-sealed");
  const payload = digest === null ? undefined : evidence.payloads().get(digest);
  return (
    (payload as { spec?: { repository?: { baseCommit?: string } } })?.spec?.repository
      ?.baseCommit ?? "unknown"
  );
}

/** The payload digest of the first record of a kind, which is the thing an attestation binds. */
function recordedDigest(evidence: EvidenceRecorder, type: string): string | null {
  return evidence.records().find((record) => record.type === type)?.payloadDigest ?? null;
}

function recordedField(evidence: EvidenceRecorder, type: string, field: string): string | null {
  const record = evidence.records().findLast((entry) => entry.type === type);
  const payload = record === undefined ? undefined : evidence.payloads().get(record.payloadDigest);
  const value = (payload as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : null;
}

function writeOut(line: string): void {
  process.stdout.write(`${line}\n`);
}
