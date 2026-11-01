import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ExecutionPolicy,
  type Producer,
  requestVersion,
  snapshotWorkingTree,
  type VerifyResult,
  verifierVersion,
  verify,
} from "swarm-verify";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { feedbackOf } from "./feedback.ts";
import type { HeldResult, Snapshot } from "./finalize.ts";
import type { Verification } from "./loop.ts";
import { type RequirementRecord, recordSha256 } from "./requirement-record.ts";

/** Where sessions, baselines and sealed checks live: SWARM_HOME, or ~/.swarm. */
export function swarmHome(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SWARM_HOME ?? join(homedir(), ".swarm");
}

const installable = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "uv.lock",
];

/**
 * Dependencies are installed fresh from the lockfile where the repository has one the verifier
 * installs from, so results are reproducible and upgrades are judged on their own lockfile.
 * Without one, the workspace's installed tree is linked, which the result reports as not
 * reproducible.
 */
export async function dependencyPolicy(workspace: string): Promise<"prepare" | "linked"> {
  const found = await Promise.all(
    installable.map((name) =>
      access(join(workspace, name)).then(
        () => true,
        () => false,
      ),
    ),
  );
  return found.some(Boolean) ? "prepare" : "linked";
}

/** The ledger as written so far: its digest and how many records it holds, for the signature. */
export async function ledgerPrefix(
  path: string,
): Promise<{ readonly ledgerSha256: string; readonly ledgerRecords: number }> {
  const text = await readFile(path, "utf8");
  const records = text.split("\n").filter((line) => line.length > 0).length;
  return { ledgerSha256: createHash("sha256").update(text).digest("hex"), ledgerRecords: records };
}

/** Time held back for final verification before the first one has been timed. */
const defaultReserveMs = 120_000;

export interface Verifier {
  /** Verifies one snapshot under a record, keeping the result as the one the run holds. */
  snapshot(snapshot: Snapshot, record: RequirementRecord, directory: string): Promise<VerifyResult>;
  /** Snapshots the working tree into the next verification directory and verifies it. */
  tree(record: RequirementRecord): Promise<Verification>;
  held(): HeldResult | null;
  /** The time to keep back for a final verification: the last one's, with room to spare. */
  reserveMs(): number;
}

/** The run's verifier: every request names the base, the policy, the producer and the ledger so far. */
export function createVerifier(input: {
  readonly workspace: string;
  readonly base: string;
  readonly execution: ExecutionPolicy;
  readonly behaviorChange: "none" | "authorized";
  readonly evidence: EvidenceRecorder;
  readonly producer: Pick<Producer, "name" | "version" | "promptSha256" | "instructions">;
  readonly model: () => string;
  readonly signal?: AbortSignal | undefined;
}): Verifier {
  let held: HeldResult | null = null;
  let reserve = defaultReserveMs;
  let count = 0;
  const snapshot = async (candidate: Snapshot, record: RequirementRecord, directory: string) => {
    const began = Date.now();
    const result = await verify(
      {
        version: requestVersion,
        repository: input.workspace,
        base: { commit: input.base },
        candidate: { kind: "patch", path: candidate.path, sha256: candidate.sha256 },
        requirements: [...record.requirements],
        policy: { behaviorChange: input.behaviorChange, execution: input.execution },
        artifacts: { directory },
        producer: {
          ...input.producer,
          model: input.model(),
          reportSha256: recordSha256(record),
          ...(await ledgerPrefix(input.evidence.ledgerPath)),
        },
      },
      { verifierVersion, ...(input.signal === undefined ? {} : { signal: input.signal }) },
    );
    reserve = Math.max(30_000, Math.ceil((Date.now() - began) * 1.5));
    held = { patchSha256: candidate.sha256, recordSha256: recordSha256(record), result };
    return result;
  };
  return {
    snapshot,
    async tree(record) {
      count += 1;
      const directory = join(input.evidence.directory, "verifications", String(count));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const taken = await snapshotWorkingTree(
        input.workspace,
        input.base,
        join(directory, "candidate.patch"),
      );
      const digest = recordSha256(record);
      // The same patch under the same record is the same immutable input: its result stands.
      const same = held?.patchSha256 === taken.sha256 && held.recordSha256 === digest;
      const result = same && held !== null ? held.result : await snapshot(taken, record, directory);
      return {
        state: result.state,
        patchSha256: taken.sha256,
        recordSha256: digest,
        feedback: feedbackOf(result),
        reused: same,
      };
    },
    held: () => held,
    reserveMs: () => reserve,
  };
}

/** What a run the user authorized to change tested behavior says it changed, from the result. */
export function behaviorChangeNote(result: VerifyResult | null): string {
  const superseded = (result?.checks ?? []).flatMap((check) => check.tests?.superseded ?? []);
  return `The user authorized a change of tested behavior (--authorize-behavior-change); expectations it superseded: ${superseded.length === 0 ? "none" : superseded.join(", ")}.`;
}
