import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { acceptanceContractSchema } from "../evidence/acceptance-contract.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createContractExecutor } from "./contract-executor.ts";
import type { GateCommandRunner } from "./gate-definition.ts";

export const acceptancePackageSchema = z
  .object({
    contract: acceptanceContractSchema,
    artifacts: z.record(z.string().regex(/^sha256:[0-9a-f]{64}$/), z.string()),
    patches: z.record(z.string().regex(/^sha256:[0-9a-f]{64}$/), z.string()),
  })
  .superRefine((pack, context) => {
    for (const [digest, text] of [
      ...Object.entries(pack.artifacts),
      ...Object.entries(pack.patches),
    ])
      if (digestOfBytes(text) !== digest)
        context.addIssue({ code: "custom", message: `content digest mismatch: ${digest}` });
    for (const requirement of pack.contract.requirements) {
      if (
        pack.artifacts[requirement.artifactDigest] === undefined ||
        pack.patches[requirement.referenceDigest] === undefined ||
        pack.patches[requirement.violatingControlDigest] === undefined
      )
        context.addIssue({
          code: "custom",
          message: `missing instrument or control for ${requirement.id}`,
        });
    }
  });

export async function acceptancePackageExecutor(
  path: string,
  options: {
    repositoryRoot: string;
    baseCommit: string;
    candidatePatch: string;
    evidence: EvidenceRecorder;
    preparationCommands: GateCommandRunner;
    commands: (checkout: string) => Promise<GateCommandRunner>;
    timeoutMs: number;
  },
) {
  const pack = acceptancePackageSchema.parse(JSON.parse(await readFile(path, "utf8")));
  const candidatePatchDigest = digestOfBytes(options.candidatePatch);
  const patches = { ...pack.patches, [candidatePatchDigest]: options.candidatePatch };
  const execute = createContractExecutor({
    ...options,
    candidatePatchDigest,
    artifact: async (digest) => pack.artifacts[digest] ?? "",
    prepare: async (digest) => {
      const patch = patches[digest];
      if (patch === undefined || digestOfBytes(patch) !== digest)
        throw new Error(`control patch ${digest} is unavailable`);
      const checkout = await mkdtemp(join(options.evidence.directory, "swarm-obligation-"));
      const dispose = () => rm(checkout, { recursive: true, force: true });
      try {
        for (const argv of [
          ["git", "clone", "--quiet", "--no-hardlinks", options.repositoryRoot, checkout],
          ["git", "-C", checkout, "checkout", "--quiet", "--detach", options.baseCommit],
        ]) {
          const ran = await options.preparationCommands.runVouched(argv, {
            cwd: tmpdir(),
            timeoutMs: options.timeoutMs,
          });
          if (ran.exitCode !== 0)
            throw new Error(`cannot prepare obligation checkout: ${ran.stderr}`);
        }
        if (patch.length > 0) {
          const patchFile = join(checkout, ".swarm-obligation.patch");
          await writeFile(patchFile, patch);
          const applied = await options.preparationCommands.runVouched(
            ["git", "apply", "--whitespace=nowarn", patchFile],
            { cwd: checkout, timeoutMs: options.timeoutMs },
          );
          await rm(patchFile);
          if (applied.exitCode !== 0)
            throw new Error(`control patch did not apply: ${applied.stderr}`);
        }
        return { path: checkout, dispose };
      } catch (cause) {
        await dispose();
        throw cause;
      }
    },
  });
  return { contract: pack.contract, evidence: options.evidence, execute };
}
