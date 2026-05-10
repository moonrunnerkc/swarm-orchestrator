/**
 * Workspace rollback primitive. Restore files mutated by a single
 * obligation to their pre-apply state, modeled on the ARIES UNDO phase
 * (Mohan et al. 1992, ACM TODS 17(1)).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type {
  ObligationRolledBackEntry,
  WorkspaceSnapshotEntry,
} from '../ledger/types';
import { gitHashObject } from './diff-snapshot';

export type RollbackTrigger = ObligationRolledBackEntry['trigger'];

export interface RollbackResult {
  success: boolean;
  restoredFiles: ReadonlyArray<{
    path: string;
    restoredBlobSha: string | 'absent';
  }>;
  /** Populated when `success` is false. */
  failure?:
    | { kind: 'no-snapshot-found'; detail: string }
    | { kind: 'state-mismatch'; detail: string; offendingPath: string }
    | { kind: 'recovery-invariant-violated'; detail: string; offendingPath: string }
    | { kind: 'io-error'; detail: string };
}

/**
 * Find the most recent `WorkspaceSnapshotEntry` for the given obligation
 * index by scanning the ledger from newest to oldest.
 */
function findLatestSnapshot(
  ledger: JsonlLedger,
  obligationIndex: number,
): WorkspaceSnapshotEntry | null {
  const entries = ledger.readAll();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e && e.type === 'workspace-snapshot' && e.obligationIndex === obligationIndex) {
      return e;
    }
  }
  return null;
}

/**
 * Restore the workspace files an obligation modified to their pre-apply
 * state. Modeled on the ARIES UNDO phase (Mohan et al. 1992): every
 * undo writes a Compensation Log Record (here, an
 * `ObligationRolledBackEntry`) so a crash mid-rollback is resumable.
 *
 * Algorithm:
 *  1. Find the most recent `WorkspaceSnapshotEntry` for `obligationIndex`
 *     in the ledger. If none, return `no-snapshot-found`.
 *  2. Idempotency check: for each file, if the current on-disk SHA
 *     already equals `preBlobSha`, treat it as already-restored
 *     (record `restoredBlobSha = preBlobSha` in the result, do not
 *     rewrite). Calling rollback twice in a row is a no-op on the
 *     second call.
 *  3. State check: if the current on-disk SHA matches neither
 *     `preBlobSha` (already restored) nor `expectedPostBlobSha` (the
 *     state we expect to be undoing), return `state-mismatch` with the
 *     offending path. The workspace was mutated between apply and
 *     rollback by something we don't control; refusing to overwrite is
 *     the safe move.
 *  4. Restore: for each file whose current SHA matches
 *     `expectedPostBlobSha`, either write the pre-apply bytes from the
 *     sidecar directory or `fs.unlink` the file if `preBlobSha` is
 *     'absent'. After each restore, hash the on-disk content and
 *     verify it equals `preBlobSha`. If it doesn't, the write didn't
 *     land as intended; return `recovery-invariant-violated` and stop.
 *     This is the ARIES recovery invariant: at end of UNDO, file state
 *     equals the logged before-image, verified by hash, not by
 *     successful syscall return.
 *  5. Return success with the per-file `restoredBlobSha` list.
 *
 * The caller appends the `ObligationRolledBackEntry` to the ledger
 * after this function returns, using the returned `restoredFiles` as
 * the entry's payload. This keeps `rollbackObligation` independent of
 * the ledger-write side effect for testability.
 */
export async function rollbackObligation(
  obligationIndex: number,
  ledger: JsonlLedger,
  repoRoot: string,
  runId: string,
  _trigger: RollbackTrigger,
): Promise<RollbackResult> {
  const snapshot = findLatestSnapshot(ledger, obligationIndex);
  if (!snapshot) {
    return {
      success: false,
      restoredFiles: [],
      failure: {
        kind: 'no-snapshot-found',
        detail: `no workspace-snapshot entry found for obligation ${obligationIndex}`,
      },
    };
  }

  const sidecarRoot = path.join(repoRoot, '.swarm', 'snapshots', runId, String(obligationIndex));
  const restoredFiles: Array<{ path: string; restoredBlobSha: string | 'absent' }> = [];

  for (const f of snapshot.files) {
    const absPath = path.join(repoRoot, f.path);
    let currentSha: string | 'absent';
    try {
      currentSha = fs.existsSync(absPath) ? gitHashObject(fs.readFileSync(absPath)) : 'absent';
    } catch (err) {
      return {
        success: false,
        restoredFiles,
        failure: {
          kind: 'io-error',
          detail: `failed to read current state of ${f.path}: ${(err as Error).message}`,
        },
      };
    }

    if (currentSha === f.preBlobSha) {
      restoredFiles.push({ path: f.path, restoredBlobSha: f.preBlobSha });
      continue;
    }

    if (currentSha !== f.expectedPostBlobSha) {
      return {
        success: false,
        restoredFiles,
        failure: {
          kind: 'state-mismatch',
          detail: `rollback for obligation ${obligationIndex} failed: file ${f.path} current SHA ${currentSha} does not match expected post-apply SHA ${f.expectedPostBlobSha}; workspace was mutated between apply and rollback`,
          offendingPath: f.path,
        },
      };
    }

    try {
      if (f.preBlobSha === 'absent') {
        fs.unlinkSync(absPath);
        restoredFiles.push({ path: f.path, restoredBlobSha: 'absent' });
      } else {
        const sidecarFile = path.join(sidecarRoot, f.preBlobSha);
        const preBytes = fs.readFileSync(sidecarFile);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, preBytes);
        const afterSha = gitHashObject(fs.readFileSync(absPath));
        if (afterSha !== f.preBlobSha) {
          return {
            success: false,
            restoredFiles,
            failure: {
              kind: 'recovery-invariant-violated',
              detail: `rollback for obligation ${obligationIndex} failed: file ${f.path} restored SHA ${afterSha} does not match expected pre-apply SHA ${f.preBlobSha}; write did not land as intended`,
              offendingPath: f.path,
            },
          };
        }
        restoredFiles.push({ path: f.path, restoredBlobSha: f.preBlobSha });
      }
    } catch (err) {
      return {
        success: false,
        restoredFiles,
        failure: {
          kind: 'io-error',
          detail: `rollback for obligation ${obligationIndex} failed: ${(err as Error).message}`,
        },
      };
    }
  }

  return { success: true, restoredFiles };
}
