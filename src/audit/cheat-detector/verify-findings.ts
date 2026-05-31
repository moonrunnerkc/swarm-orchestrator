// Verification stage. The detectors are deliberately high-recall
// candidate generators: they fire on a surface pattern (a new branch
// with no test, a mock target missing from a manifest, a removed
// assertion) without weighing the legitimate explanations. On real
// merged PRs that makes them noisy. This stage is the second half of a
// candidate-generation + verification pipeline: it refutes a candidate
// finding when the diff itself carries the evidence that the pattern is
// legitimate, so only findings that survive refutation reach the
// reviewer.
//
// Every refuter here encodes a legitimate-explanation principle that
// holds for any PR, not a fit to the labeled corpus:
//
//   - no-op-fix / coverage-erosion only mean "the fix missed the code
//     path" when the PR actually claims a fix. Their own messages say
//     so ("If this PR claimed to fix a failing test..."). On a feature
//     or chore PR, "new code has no test" is ordinary development, so
//     the finding is demoted to an informational note rather than a
//     warning. (It is demoted, not dropped, so a bare --diff-file audit
//     with no PR context still records the observation.)
//   - fake-refactor pairs a removed symbol with an added one and calls
//     it a rename. When one removed symbol is paired with several
//     different added names in the same file, the pairing is unreliable
//     by construction and should not fire.
//   - test-relaxation / assertion-strip flag removed tests. When the
//     same PR also deletes non-test source, removing the tests that
//     covered it is legitimate cleanup, not coverage gaming.
//
// The LLM-judge confirmation gate composes on top of this stage; it
// handles the semantic cases the deterministic refuters cannot
// (an empty catch that is intentional, a mock of a real-but-unusual
// module) without changing the contract here.

import type { File as ParsedDiffFile } from 'parse-diff';
import type { CheatCategory, Finding, Severity } from '../types';
import type { PrIntent } from './pr-intent';
import { fileKind, filePath, isTestFile } from './diff-walker';
import { getLogger } from '../../logger';

const logger = getLogger('audit:verify');

export interface VerificationContext {
  files: readonly ParsedDiffFile[];
  intent: PrIntent;
}

export interface SuppressedFinding {
  finding: Finding;
  /** Machine-stable refuter id, e.g. `no-fix-claim`, `ambiguous-rename`. */
  rule: string;
  /** Human-readable reason, surfaced in the ledger and shadow output. */
  reason: string;
}

export interface VerificationResult {
  kept: Finding[];
  suppressed: SuppressedFinding[];
}

type Refutation =
  | { action: 'drop'; rule: string; reason: string }
  | { action: 'downgrade'; rule: string; reason: string; severity: Severity };

/** Categories whose signal is only meaningful when the PR claims a fix. */
const FIX_CLAIM_GATED: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'no-op-fix',
  'coverage-erosion',
]);

/** Categories that flag removed test coverage. */
const TEST_REMOVAL: ReadonlySet<CheatCategory> = new Set<CheatCategory>([
  'test-relaxation',
  'assertion-strip',
]);

const RENAME_MESSAGE = /^Function "([^"]+)" was renamed to "([^"]+)"/;

/**
 * Refute candidate findings against the diff context. Returns the
 * findings that survived plus the ones that were suppressed, each with
 * the rule and reason so the suppression is auditable rather than
 * silent.
 */
export function verifyFindings(
  findings: readonly Finding[],
  ctx: VerificationContext,
): VerificationResult {
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];

  const ambiguousRenameKeys = collectAmbiguousRenameKeys(findings);
  const deletesNonTestSource = hasNonTestSourceDeletion(ctx.files);

  for (const finding of findings) {
    const refutation = refute(finding, ctx, {
      ambiguousRenameKeys,
      deletesNonTestSource,
    });
    if (refutation === undefined) {
      kept.push(finding);
      continue;
    }
    if (refutation.action === 'downgrade') {
      finding.severity = refutation.severity;
      kept.push(finding);
      continue;
    }
    suppressed.push({ finding, rule: refutation.rule, reason: refutation.reason });
  }

  if (suppressed.length > 0) {
    logger.debug(
      `verification suppressed ${suppressed.length}/${findings.length} candidate finding(s)`,
    );
  }
  return { kept, suppressed };
}

interface RefuteState {
  ambiguousRenameKeys: ReadonlySet<string>;
  deletesNonTestSource: boolean;
}

function refute(
  finding: Finding,
  ctx: VerificationContext,
  state: RefuteState,
): Refutation | undefined {
  // Already informational findings have nothing to refute or demote.
  if (finding.severity === 'info') return undefined;

  if (FIX_CLAIM_GATED.has(finding.category) && !ctx.intent.claimsFix) {
    return {
      action: 'downgrade',
      severity: 'info',
      rule: 'no-fix-claim',
      reason:
        `${finding.category} only indicates a missed fix when the PR claims one; ` +
        `this PR makes no fix claim, so new code without a test is ordinary change`,
    };
  }

  if (finding.category === 'fake-refactor') {
    const key = renameKey(finding);
    if (key !== undefined && state.ambiguousRenameKeys.has(key)) {
      return {
        action: 'drop',
        rule: 'ambiguous-rename',
        reason:
          'the same removed symbol was paired with more than one added name, ' +
          'so the rename pairing is unreliable',
      };
    }
  }

  if (TEST_REMOVAL.has(finding.category) && state.deletesNonTestSource) {
    return {
      action: 'drop',
      rule: 'source-co-removed',
      reason:
        'the PR also deletes non-test source, so removing the tests that ' +
        'covered it is legitimate cleanup rather than coverage gaming',
    };
  }

  return undefined;
}

/**
 * A fake-refactor finding is keyed by `<file>::<oldName>`. When two
 * findings share a key but disagree on the new name, every finding with
 * that key is ambiguous.
 */
function collectAmbiguousRenameKeys(findings: readonly Finding[]): Set<string> {
  const newNamesByKey = new Map<string, Set<string>>();
  for (const finding of findings) {
    if (finding.category !== 'fake-refactor') continue;
    const parsed = parseRename(finding);
    if (parsed === undefined) continue;
    const key = `${finding.location.file}::${parsed.oldName}`;
    const set = newNamesByKey.get(key) ?? new Set<string>();
    set.add(parsed.newName);
    newNamesByKey.set(key, set);
  }
  const ambiguous = new Set<string>();
  for (const [key, names] of newNamesByKey) {
    if (names.size > 1) ambiguous.add(key);
  }
  return ambiguous;
}

function renameKey(finding: Finding): string | undefined {
  const parsed = parseRename(finding);
  if (parsed === undefined) return undefined;
  return `${finding.location.file}::${parsed.oldName}`;
}

function parseRename(finding: Finding): { oldName: string; newName: string } | undefined {
  const m = finding.message.match(RENAME_MESSAGE);
  if (m === null || m[1] === undefined || m[2] === undefined) return undefined;
  return { oldName: m[1], newName: m[2] };
}

/**
 * Assign a reviewer-facing confidence to every finding from the
 * evidence behind it. Mutates in place. Judge confirmation is the
 * strongest signal; a PR-intent escalation is next; otherwise severity
 * stands in for confidence (an info-severity note is low confidence by
 * construction). Called by the engine after the verification and judge
 * stages so it sees the final severity and judge verdict.
 */
export function assignConfidence(findings: readonly Finding[]): void {
  for (const f of findings) {
    if (f.judgeConfirmed === true) {
      f.confidence = 'high';
    } else if (f.intentUpgraded === true) {
      f.confidence = 'high';
    } else if (f.severity === 'block') {
      f.confidence = 'high';
    } else if (f.severity === 'warn') {
      f.confidence = 'medium';
    } else {
      f.confidence = 'low';
    }
  }
}

function hasNonTestSourceDeletion(files: readonly ParsedDiffFile[]): boolean {
  for (const file of files) {
    if (fileKind(file) !== 'delete') continue;
    const p = filePath(file);
    if (p.length === 0) continue;
    if (isTestFile(p)) continue;
    return true;
  }
  return false;
}
