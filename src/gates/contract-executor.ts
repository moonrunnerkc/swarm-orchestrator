import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AcceptanceContract } from "../evidence/acceptance-contract.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { RequirementObservation } from "./contract-verification.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import { harnessControlledNodeTest, processIsolation, shellQuoted } from "./node-test-command.ts";
import { parseTapOutcomes, parseTapTotals } from "./parsers.ts";

/** Each control and candidate gets a fresh checkout of the exact named patch. */
export function createContractExecutor(options: {
  evidence: EvidenceRecorder;
  candidatePatchDigest: string;
  artifact: (digest: string) => Promise<string>;
  prepare: (patchDigest: string) => Promise<{ path: string; dispose: () => Promise<void> }>;
  commands: (checkout: string) => Promise<GateCommandRunner>;
  timeoutMs: number;
}) {
  return async (
    requirement: AcceptanceContract["requirements"][number],
    target: "reference" | "violating-control" | "candidate",
  ): Promise<RequirementObservation> => {
    const patchDigest =
      target === "candidate"
        ? options.candidatePatchDigest
        : target === "reference"
          ? requirement.referenceDigest
          : requirement.violatingControlDigest;
    const path = `.swarm-acceptance/${requirement.id}.test.mjs`;
    const words = requirement.argv.map(shellQuoted);
    const argv = words.some((word) => word === null)
      ? null
      : harnessControlledNodeTest(words.join(" "), [
          processIsolation,
          "--test-reporter=tap",
          "--test-reporter-destination=stdout",
        ]);
    if (argv === null || requirement.argv.at(-1) !== path)
      throw new Error(
        `requirement ${requirement.id} needs a controlled node test invocation ending in ${path}`,
      );
    const artifact = await options.artifact(requirement.artifactDigest);
    if (digestOfBytes(artifact) !== requirement.artifactDigest)
      throw new Error(`acceptance artifact digest mismatch for ${requirement.id}`);
    const checkout = await options.prepare(patchDigest);
    let status: RequirementObservation["status"] = "unavailable";
    let observation: Record<string, unknown> = {};
    try {
      const destination = join(checkout.path, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, artifact, { flag: "wx" });
      const commands = await options.commands(checkout.path);
      const ran = await commands.runVouched(argv, {
        cwd: checkout.path,
        timeoutMs: options.timeoutMs,
      });
      const totals = parseTapTotals(ran.stdout);
      const outcomes = parseTapOutcomes(ran.stdout);
      const assertion = /^\s+code: ['"]?ERR_ASSERTION['"]?\s*$/m.test(ran.stdout);
      status =
        ran.unavailable !== null ||
        ran.outputTruncated === true ||
        totals === null ||
        outcomes === null ||
        totals.collected - totals.skipped === 0
          ? "unavailable"
          : ran.exitCode === 0
            ? "passed"
            : assertion && outcomes.failed.length > 0
              ? "assertion-failed"
              : "unavailable";
      observation = { ...ran, argv: [...argv] };
      await rm(destination);
    } catch (cause) {
      observation = { unavailable: cause instanceof Error ? cause.message : String(cause) };
    } finally {
      await checkout.dispose();
    }
    const recorded = await options.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: JSON.parse(
        JSON.stringify({
          rule: "controlled-node-tap-v1",
          requirementId: requirement.id,
          target,
          patchDigest,
          artifactDigest: requirement.artifactDigest,
          status,
          ...observation,
        }),
      ),
    });
    return { status, evidenceDigest: recorded.record.payloadDigest };
  };
}
