/**
 * Workspace snapshot primitive: record pre-apply file state before a
 * producer's patch is applied, and compute post-apply SHAs after the
 * applier has run.
 *
 * Sidecar directory rationale: inline base64 in the ledger entry would
 * inflate JSONL size for large `file-must-exist` bodies. The sidecar
 * keeps the ledger small and gives rollback a stable place to read
 * original bytes from. Cleanup of the sidecar after a successful run is
 * out of scope for this PR; a one-line note goes in the README under
 * "Cleanup".
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ObligationV1 } from '../contract/types';
import type { WorkspaceSnapshotEntry } from '../ledger/types';
import { listAffectedPaths, looksLikeUnifiedDiff } from './unified-diff';
import { looksLikeWholeFileResponse, parseWholeFileBlocks } from './whole-file-apply';

/**
 * Compute a SHA1 in the same format `git hash-object` produces, so blob
 * SHAs in the ledger are interoperable with git tooling for debugging.
 * Format: `blob <byteLength>\0<content>` hashed with SHA1.
 */
export function gitHashObject(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  return crypto.createHash('sha1').update(header, 'utf8').update(content).digest('hex');
}

/** What the snapshot helper records before applying a patch. */
export interface PreApplySnapshot {
  obligationIndex: number;
  files: ReadonlyArray<{
    path: string;
    preBlobSha: string | 'absent';
  }>;
}

/**
 * Build the sidecar directory path for a snapshot.
 */
function sidecarDir(repoRoot: string, runId: string, obligationIndex: number): string {
  return path.join(repoRoot, '.swarm', 'snapshots', runId, String(obligationIndex));
}

/**
 * Snapshot the current state of every file an obligation's response is
 * about to mutate, and stage the pre-apply bytes to the sidecar
 * directory. Returns null when there is nothing to snapshot:
 *  - Response is the literal string `no-op`.
 *  - Response is neither a unified diff nor a `file-must-exist` body.
 *  - Diff parses to zero affected paths.
 *
 * The sidecar directory layout is
 * `.swarm/snapshots/<runId>/<obligationIndex>/<preBlobSha>` containing
 * the raw pre-apply bytes for each file. Files whose pre-apply state is
 * 'absent' are recorded in the snapshot but no sidecar file is written
 * for them; rollback handles 'absent' by `fs.unlink`.
 *
 * Idempotent: calling twice for the same (runId, obligationIndex)
 * overwrites the sidecar directory and returns a fresh snapshot.
 */
export function snapshotBeforeApply(
  repoRoot: string,
  runId: string,
  obligation: ObligationV1,
  obligationIndex: number,
  responseText: string,
): PreApplySnapshot | null {
  const trimmed = responseText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') {
    return null;
  }

  let affectedPaths: readonly string[];
  if (obligation.type === 'file-must-exist') {
    affectedPaths = [obligation.path];
  } else if (looksLikeUnifiedDiff(trimmed)) {
    affectedPaths = listAffectedPaths(trimmed);
    if (affectedPaths.length === 0) {
      return null;
    }
  } else if (looksLikeWholeFileResponse(trimmed)) {
    // Whole-file response format: each <<<FILE <path> ... FILE>>>
    // block names a file the applier will overwrite. We need
    // pre-snapshots for all of them so rollback can restore on
    // failure, exactly like unified-diff.
    try {
      affectedPaths = parseWholeFileBlocks(trimmed).map((b) => b.relPath);
    } catch {
      return null;
    }
    if (affectedPaths.length === 0) {
      return null;
    }
  } else {
    return null;
  }

  const sidecar = sidecarDir(repoRoot, runId, obligationIndex);
  if (fs.existsSync(sidecar)) {
    fs.rmSync(sidecar, { recursive: true, force: true });
  }

  const files: Array<{ path: string; preBlobSha: string | 'absent' }> = [];
  for (const relPath of affectedPaths) {
    const absPath = path.join(repoRoot, relPath);
    const exists = fs.existsSync(absPath);
    if (!exists) {
      files.push({ path: relPath, preBlobSha: 'absent' });
      continue;
    }
    const content = fs.readFileSync(absPath);
    const sha = gitHashObject(content);
    files.push({ path: relPath, preBlobSha: sha });
    const sidecarFile = path.join(sidecar, sha);
    fs.mkdirSync(path.dirname(sidecarFile), { recursive: true });
    fs.writeFileSync(sidecarFile, content);
  }

  if (files.length === 0) {
    return null;
  }

  return { obligationIndex, files };
}

/**
 * After the applier has run, hash each affected file's post-apply
 * content and pair it with the pre-apply SHA from `pre`. The output is
 * the `files` array for the `WorkspaceSnapshotEntry` written to the
 * ledger. Reads from disk; never trusts `responseText` as a proxy for
 * post-apply state, because `applyUnifiedDiff` may reject patches,
 * normalize line endings, or skip protected paths.
 */
export function computePostApplyShas(
  repoRoot: string,
  pre: PreApplySnapshot,
): WorkspaceSnapshotEntry['files'] {
  return pre.files.map((f) => {
    const absPath = path.join(repoRoot, f.path);
    const exists = fs.existsSync(absPath);
    const postSha = exists ? gitHashObject(fs.readFileSync(absPath)) : 'absent';
    return {
      path: f.path,
      preBlobSha: f.preBlobSha,
      expectedPostBlobSha: postSha,
    };
  });
}
