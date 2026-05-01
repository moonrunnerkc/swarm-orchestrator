import { createHash } from 'crypto';
import type { Finding } from '../types/finding';

const FINDING_MARKER_PATTERN = /<!-- swarm-finding-id:([a-f0-9]{16}) -->\s*$/;
const FINDING_HASH_PATTERN = /^[a-f0-9]{16}$/;

export interface ExistingComment {
  id: number;
  body: string;
  findingId: string | null;
}

interface ReconcileFindingsArgs {
  existingComments: ExistingComment[];
  currentFindings: Finding[];
}

interface ReconciledFindings {
  toPost: Finding[];
  toResolve: ExistingComment[];
  unchanged: ExistingComment[];
}

function findingFilePath(finding: Finding): string {
  return finding.scope === 'summary' ? '' : finding.filePath;
}

function findingLine(finding: Finding): number {
  return finding.scope === 'line' ? finding.line : 0;
}

/**
 * Compute the stable deduplication id for a finding.
 *
 * @param finding - Finding to identify across repeated PR review runs.
 * @returns First 16 hex characters of the SHA-256 hash for stable finding fields.
 */
export function computeFindingId(finding: Finding): string {
  const hashInput = [
    findingFilePath(finding),
    String(findingLine(finding)),
    finding.ruleId,
    finding.message,
  ];
  return createHash('sha256').update(JSON.stringify(hashInput)).digest('hex').slice(0, 16);
}

/**
 * Parse a swarm finding marker from the end of a GitHub review comment body.
 *
 * @param body - Existing review comment body from GitHub.
 * @returns Parsed 16-character finding hash, or null when no strict marker is present.
 */
export function parseFindingId(body: string): string | null {
  const match = body.match(FINDING_MARKER_PATTERN);
  return match ? match[1] : null;
}

/**
 * Append a non-rendering swarm finding marker as the final line of a comment body.
 *
 * @param body - Markdown review comment body without the marker.
 * @param hash - 16-character finding hash from computeFindingId.
 * @returns Comment body with the final-line HTML marker appended.
 */
export function appendFindingMarker(body: string, hash: string): string {
  if (!FINDING_HASH_PATTERN.test(hash)) {
    throw new Error('failed to append finding marker: hash must be 16 lowercase hex characters; pass computeFindingId output');
  }
  return `${body.trimEnd()}\n\n<!-- swarm-finding-id:${hash} -->`;
}

/**
 * Partition current findings against existing marked review comments.
 *
 * @param args - Existing PR review comments and findings from the current run.
 * @returns Findings to post, comments to resolve, and comments already represented.
 */
export function reconcileFindings(args: ReconcileFindingsArgs): ReconciledFindings {
  const existingIds = new Set(
    args.existingComments
      .map(comment => comment.findingId)
      .filter((findingId): findingId is string => findingId !== null),
  );
  const currentIds = new Set(args.currentFindings.map(computeFindingId));
  const seenPostIds = new Set<string>();
  const toPost: Finding[] = [];

  for (const finding of args.currentFindings) {
    const findingId = computeFindingId(finding);
    if (!existingIds.has(findingId) && !seenPostIds.has(findingId)) {
      toPost.push(finding);
      seenPostIds.add(findingId);
    }
  }

  const toResolve: ExistingComment[] = [];
  const unchanged: ExistingComment[] = [];
  for (const comment of args.existingComments) {
    if (comment.findingId === null) continue;
    if (currentIds.has(comment.findingId)) {
      unchanged.push(comment);
    } else {
      toResolve.push(comment);
    }
  }

  return { toPost, toResolve, unchanged };
}
