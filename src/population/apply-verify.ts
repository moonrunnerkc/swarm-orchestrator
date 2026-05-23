import type { ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type { WorkspaceSnapshotEntry, ObligationRolledBackEntry } from '../ledger/types';
import { applyFileEmit } from './diff-applier';
import { computePostApplyShas, snapshotBeforeApply, type PreApplySnapshot } from './diff-snapshot';
import { rollbackObligation } from './rollback';
import { applyUnifiedDiff, looksLikeUnifiedDiff } from './unified-diff';
import { applyWholeFileResponse, looksLikeWholeFileResponse } from './whole-file-apply';
import { verifyObligation } from '../verification/run-verifier';
import { type RenderContext } from './persona-message';
import { detectTestFrameworkMisuse, isTestFilePath } from './test-framework-misuse';

export interface AttemptApplyAndVerifyArgs {
  obligation: ObligationV1;
  obligationIndex: number;
  responseText: string;
  repoRoot: string;
  ledger: JsonlLedger;
  runId: string;
  fileMustExistPaths: ReadonlySet<string>;
  commandTimeoutMs: number | undefined;
  renderContext: RenderContext;
  trigger: 'per-obligation-failed-apply' | 'per-obligation-falsification';
}

export interface AttemptApplyAndVerifyResult {
  satisfied: boolean;
  applyDetail: string;
  verifyDetail: string;
  applyOk: boolean;
  applied: boolean;
  pre: PreApplySnapshot | null;
}

export async function attemptApplyAndVerify(
  args: AttemptApplyAndVerifyArgs,
): Promise<AttemptApplyAndVerifyResult> {
  const {
    obligation,
    obligationIndex,
    responseText,
    repoRoot,
    ledger,
    runId,
    fileMustExistPaths,
    commandTimeoutMs,
    renderContext,
    trigger,
  } = args;

  // applyDetail surfaces *why* a persona's response did or didn't change
  // the workspace. Without this trace, a downstream verifier failure
  // ("predicate exited 1") gives no signal whether the persona emitted
  // an unapplyable diff, declared no-op, or simply produced prose.
  // applyOk is true when the applier produced its intended on-disk
  // outcome (file-emit landed, diff applied, or persona legitimately
  // declared no-op); false on parse/apply errors or unrecognized
  // responses. Single-mode uses applyOk to decide whether to prefix the
  // verifier detail with applyDetail in the composite failure message.
  let applyDetail: string;
  let applyOk = false;
  let applied = false;
  const pre = snapshotBeforeApply(repoRoot, runId, obligation, obligationIndex, responseText);

  if (obligation.type === 'file-must-exist') {
    const r = applyFileEmit(repoRoot, obligation.path, responseText);
    applied = true;
    applyOk = true;
    applyDetail = r.detail;
  } else if (responseText.trim() === 'no-op' || responseText.trim() === '"no-op"') {
    applyDetail = 'no-op declared';
    applyOk = true;
  } else if (looksLikeWholeFileResponse(responseText)) {
    // Whole-file replacement path: persona emits one or more
    // `<<<FILE <path> ... FILE>>>` blocks with the full new contents.
    // protectedPaths is intentionally NOT passed: in the whole-file
    // flow the persona is shown the current file body via the
    // file-context injector and asked to write the FULL new contents
    // (additive, not stomping).
    try {
      const result = applyWholeFileResponse(repoRoot, responseText);
      if (result.applied) {
        applied = true;
        applyOk = true;
        applyDetail = result.detail;
      } else {
        applyDetail = `whole-file write did not apply: ${result.detail}`;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      applyDetail = `whole-file parse/apply error: ${message}`;
      applied = true;
    }
  } else if (looksLikeUnifiedDiff(responseText)) {
    try {
      const result = applyUnifiedDiff(repoRoot, responseText, {
        protectedPaths: fileMustExistPaths,
      });
      if (result.applied) {
        applied = true;
        applyOk = true;
        applyDetail = result.detail;
      } else {
        applyDetail = `unified diff did not apply: ${result.detail}`;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      applyDetail = `unified diff parse/apply error: ${message}`;
      // A throw mid-application means an earlier hunk may have already
      // landed on disk before the failing hunk's context mismatch was
      // detected. Treat as "may have mutated" — fires the rollback
      // below, which is idempotent (no-op if pre==current).
      applied = true;
    }
  } else {
    applyDetail =
      'persona response is neither a unified diff nor "no-op" — ' +
      'workspace left unchanged. Response head: ' +
      responseText.trim().slice(0, 120).replace(/\s+/g, ' ');
  }

  if (pre) {
    const files = computePostApplyShas(repoRoot, pre);
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex,
      files,
    });
  }

  const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
  if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
  let verifyResult = verifyObligation(obligation, verifyOpts);

  // Defense-in-depth: a test file written with the wrong framework's
  // API passes file-must-exist but breaks build/test downstream. Promote
  // that misalignment into a precise, persona-attributable failure here.
  if (
    verifyResult.satisfied &&
    obligation.type === 'file-must-exist' &&
    renderContext.testFramework &&
    isTestFilePath(obligation.path)
  ) {
    const misuse = detectTestFrameworkMisuse(
      repoRoot,
      obligation.path,
      renderContext.testFramework,
    );
    if (misuse) verifyResult = { satisfied: false, detail: misuse };
  }

  const shouldRollback = !verifyResult.satisfied && pre !== null && (
    trigger === 'per-obligation-falsification'
      ? true
      : applied && obligation.type !== 'file-must-exist'
  );

  if (shouldRollback) {
    const rb = await rollbackObligation(obligationIndex, ledger, repoRoot, runId, trigger);
    ledger.append<ObligationRolledBackEntry>({
      type: 'obligation-rolled-back',
      obligationIndex,
      trigger,
      success: rb.success,
      restoredFiles: rb.restoredFiles,
      detail: rb.success
        ? trigger === 'per-obligation-failed-apply'
          ? `rolled back ${rb.restoredFiles.length} file(s) after failed apply (workspace restored to pre-attempt state)`
          : `rolled back ${rb.restoredFiles.length} file(s) after tournament winner failed verification`
        : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
    });
    if (!rb.success && rb.failure?.kind !== 'no-snapshot-found') {
      throw new Error(
        `${trigger} rollback failed for obligation ${obligationIndex}: ${rb.failure?.detail ?? 'unknown'}`,
      );
    }
  }

  return {
    satisfied: verifyResult.satisfied,
    applyDetail,
    verifyDetail: verifyResult.detail,
    applyOk,
    applied,
    pre,
  };
}
