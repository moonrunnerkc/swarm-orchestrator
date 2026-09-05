import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { PolicyGuard } from "../tools/policy-guard.ts";
import { recordExecutionEnvelope } from "./execution-envelope-record.ts";
import {
  describeExecutionEnvelope,
  type ExecutionEnvelope,
  hostExecutionBackend,
  selfTestContainment,
} from "./execution-mode.ts";

/**
 * Measures the envelope this run actually executes under and puts it on the chain, before the
 * first tool call. The self-test runs the escapes rather than reasoning about them, against a
 * decoy the harness makes for the purpose: a probe that reads a real host secret to prove it
 * could is a probe that has just read a real host secret.
 */
export async function establishExecutionEnvelope(input: {
  readonly evidence: EvidenceRecorder;
  readonly guard: PolicyGuard;
  readonly repositoryConfigTrusted: boolean;
}): Promise<ExecutionEnvelope> {
  const decoyRoot = await mkdtemp(join(tmpdir(), "swarm-containment-decoy-"));
  const decoy = join(decoyRoot, "host-secret.txt");
  try {
    await writeFile(decoy, "decoy: a value only the host should hold\n", { mode: 0o600 });

    const envelope = describeExecutionEnvelope({
      selfTest: await selfTestContainment(hostExecutionBackend, {
        workspaceRoot: input.guard.workspaceRoot,
        hostFileOutsideWorkspace: decoy,
      }),
      workspaceRoot: input.guard.workspaceRoot,
      withheldEnvironmentNames: input.guard.childEnvironment.withheld,
      repositoryConfigTrusted: input.repositoryConfigTrusted,
    });

    await recordExecutionEnvelope(input.evidence, envelope);
    return envelope;
  } finally {
    await rm(decoyRoot, { recursive: true, force: true });
  }
}

/** What a person is told before the run starts. Never the word "guard" for a lexical policy. */
export function describeEnvelopeForReader(envelope: ExecutionEnvelope): readonly string[] {
  const lines = [
    `execution mode: ${envelope.mode} (backend: ${envelope.backend})`,
    `  ${envelope.summary}`,
    `  writable: ${envelope.writablePaths.join(", ")}`,
    `  network: ${envelope.network}`,
    `  environment: ${envelope.environmentPolicy}, ${envelope.credentialNamesWithheld} names withheld from child processes`,
    `  repository configuration trusted: ${envelope.repositoryConfigTrusted ? "yes" : "no"}`,
  ];
  if (envelope.mode !== "isolated") {
    lines.push(
      "  what this does not establish: an allowlisted interpreter runs whatever a workspace",
      "  script says, so the policy bounds which programs start and not what they do once started.",
    );
  }
  return lines;
}
