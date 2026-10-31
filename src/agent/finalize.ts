import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type RequirementOutcome, snapshotWorkingTree, type VerifyResult } from "swarm-verify";
import { type RequirementRecord, recordSha256 } from "./requirement-record.ts";

export interface Snapshot {
  readonly path: string;
  readonly sha256: string;
  readonly baseCommit: string;
}

/** A verification the run already holds, and what it was of. */
export interface HeldResult {
  readonly patchSha256: string;
  readonly recordSha256: string;
  readonly result: VerifyResult;
}

export interface FinalizeInput {
  readonly workspace: string;
  readonly base: string;
  /** Where the delivered patch and the report are written: inside the session, outside the workspace. */
  readonly directory: string;
  readonly record: RequirementRecord;
  readonly held: HeldResult | null;
  /** Null to verify the snapshot now; otherwise why final verification cannot run. */
  readonly cannotVerify: string | null;
  readonly verify: (snapshot: Snapshot) => Promise<VerifyResult>;
}

export interface Finalized {
  readonly state: "complete" | "incomplete" | "blocked";
  readonly snapshot: Snapshot;
  readonly verification: "fresh" | "reused" | "not run";
  readonly result: VerifyResult | null;
  readonly requirements: readonly RequirementOutcome[];
  readonly notes: readonly string[];
}

/** Each requirement, unverified because nothing measured the delivered snapshot. */
function unmeasured(record: RequirementRecord, why: string): RequirementOutcome[] {
  return record.requirements.map((one) => ({
    id: one.id,
    text: one.text,
    source: one.source,
    kind: one.kind,
    required: one.required,
    assumptions: [...one.assumptions],
    status: "unverified",
    evidence: [],
    limitation: `final verification did not run: ${why}`,
    nextAction: "verify the delivered patch with swarm-verify",
  }));
}

/**
 * The one way a run ends. The working tree is snapshotted; a held result is reused only when it
 * measured exactly that patch under exactly this requirement record, otherwise the snapshot is
 * verified now, or, where it cannot be, reported incomplete and bound to it. The tree is read
 * again immediately before delivery, and a result that no longer describes it is not delivered
 * as one that does.
 */
export async function finalize(input: FinalizeInput): Promise<Finalized> {
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const snapshot = await snapshotWorkingTree(
    input.workspace,
    input.base,
    join(input.directory, "delivered.patch"),
  );
  const record = recordSha256(input.record);
  const notes: string[] = [];
  let unrun = "it was not run";
  let result: VerifyResult | null = null;
  let verification: Finalized["verification"] = "not run";
  if (
    input.held !== null &&
    input.held.patchSha256 === snapshot.sha256 &&
    input.held.recordSha256 === record
  ) {
    result = input.held.result;
    verification = "reused";
  } else if (input.cannotVerify === null) {
    if (input.held !== null)
      notes.push(
        "the last verification described an earlier tree or record, so the delivered one was verified again",
      );
    try {
      result = await input.verify(snapshot);
      verification = "fresh";
    } catch (error) {
      unrun = `it failed to run: ${error instanceof Error ? error.message : String(error)}`;
      notes.push(`final verification did not run: ${unrun}`);
    }
  } else {
    unrun = input.cannotVerify;
    notes.push(`final verification did not run: ${unrun}`);
  }
  const again = await snapshotWorkingTree(
    input.workspace,
    input.base,
    join(input.directory, "recheck.patch"),
  );
  const moved = again.sha256 !== snapshot.sha256;
  if (moved)
    notes.push(
      `the working tree changed after it was snapshotted (sha256 ${again.sha256}); the result describes ${snapshot.sha256} only`,
    );
  const requirements = result?.requirements ?? unmeasured(input.record, unrun);
  const state =
    result === null || moved
      ? result?.state === "blocked"
        ? "blocked"
        : "incomplete"
      : result.state;
  await writeFile(join(input.directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`, {
    mode: 0o600,
  });
  return { state, snapshot, verification, result, requirements, notes };
}
