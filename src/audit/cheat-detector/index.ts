// Public entry to the cheat-detector engine. `runCheatDetectors`
// accepts an AuditInput (already parsed diff text + repo root + optional
// PR metadata + optional agent attribution) and returns an AuditResult.
//
// Detector selection lives in `./detector-sets.ts`. v10.2 split the
// registry into a `default` set (the four advisory-grade detectors
// targeted for v2.0 work) and an `experimental` set (the six retired
// detectors that did not earn their context on the v10.1 real-corpus
// baseline). The `set` field on `AuditInput.detectorSet` chooses which
// list to load; absent, the default set is used.

import parseDiff from 'parse-diff';
import type { Detector } from './detector-types';
import type { AuditInput, AuditResult, Finding } from '../types';
import { isAuditSubjectPath } from './subject-paths';
import { buildExcludeMatcher, loadAuditConfig } from './audit-config';
import { parsePrIntent, upgradeSeverity, type PrIntent } from './pr-intent';
import { resolveDetectors, type DetectorSet } from './detector-sets';
import { verifyFindings, assignConfidence } from './verify-findings';
import { confirmFindings } from './confirm-findings';
import { runJudgePrimary } from './judge-primary';

// Re-exported for backwards compatibility with callers that pinned the
// flat list. New code should pass `detectorSet` on the AuditInput.
export const DETECTORS: readonly Detector[] = resolveDetectors('all');

export async function runCheatDetectors(input: AuditInput): Promise<AuditResult> {
  const allFiles = parseDiff(input.unifiedDiff);
  // Two filters compose: the built-in subject-path filter (data files
  // and conventional fixture / corpus dirs) and the project-level
  // `.swarm/audit-config.yaml` exclude list (for repos whose own
  // source legitimately contains literal cheat patterns — detector
  // tests, rule packs, generator scripts).
  const config = loadAuditConfig(input.repoRoot);
  const excludeFromConfig = buildExcludeMatcher(config.excludePaths);
  const files = allFiles.filter((f) => {
    const p = f.to ?? f.from ?? null;
    if (!isAuditSubjectPath(p)) return false;
    if (p && excludeFromConfig(p)) return false;
    return true;
  });
  const ctx: import('./detector-types').DetectorContext = {
    files,
    repoRoot: input.repoRoot,
  };
  if (input.pr !== undefined) ctx.pr = input.pr;
  if (input.judgeEnabled === true) {
    const judgeConfig: import('./detector-types').DetectorJudgeConfig = {
      enabled: true,
      unifiedDiff: input.unifiedDiff,
    };
    if (input.judgeLedger !== undefined) judgeConfig.ledger = input.judgeLedger;
    ctx.judgeConfig = judgeConfig;
  }
  const findings: Finding[] = [];
  const detectorVersions: Record<string, string> = {};
  const detectorSet: DetectorSet = input.detectorSet ?? 'default';
  const detectors = resolveDetectors(detectorSet);
  for (const detector of detectors) {
    detectorVersions[detector.name] = detector.version;
    const result = await detector.run(ctx);
    for (const finding of result) {
      findings.push(finding);
    }
  }
  // PR-intent severity escalation. Engine post-processes findings
  // rather than threading the policy through every detector, since
  // the policy is uniform and the alternative would touch all 10
  // detector files. Severity upgrades are marked on each finding via
  // Finding.intentUpgraded so the renderer can show one top-of-
  // comment line quoting the agent's claim.
  const intent = parsePrIntent(input.pr);
  // Verification stage: refute candidate findings the diff itself shows
  // to be legitimate, before the PR-intent layer escalates severity.
  // Gating runs first so a fix-claim escalation only applies to a
  // finding that survived refutation.
  const verification = verifyFindings(findings, { files, intent });
  let kept = verification.kept;
  applyIntentSeverity(kept, intent, config.intentSeverityPolicy);

  // Judge confirmation gate. When enabled, a block-severity finding must
  // be confirmed by the judge to stay a block; a refuted finding drops to
  // advisory. Off by default so the no-credentials path is unchanged.
  if (input.judgeEnabled === true) {
    const confirmCtx: import('./confirm-findings').ConfirmContext = {
      unifiedDiff: input.unifiedDiff,
      prTitle: input.pr?.title ?? '',
      repoRoot: input.repoRoot,
    };
    if (input.judgeLedger !== undefined) confirmCtx.ledger = input.judgeLedger;
    const confirmed = await confirmFindings(kept, confirmCtx);
    kept = confirmed.findings;

    // Judge-primary path. The structural detectors are blind to the
    // semantic categories, so the judge runs directly against the diff and
    // the PR's claim and raises a finding when the claim is not delivered.
    // Gated by judgePrimary.enabled (default on); requires the judge to be
    // enabled so the no-credentials default path stays deterministic.
    if (config.judgePrimary.enabled && config.judgePrimary.categories.length > 0) {
      const primaryCtx: import('./judge-primary').JudgePrimaryContext = {
        unifiedDiff: input.unifiedDiff,
        claim: input.pr?.title ?? '',
        repoRoot: input.repoRoot,
        files,
        categories: config.judgePrimary.categories,
        block: config.judgePrimary.block,
      };
      if (input.judgeLedger !== undefined) primaryCtx.ledger = input.judgeLedger;
      const primaryFindings = await runJudgePrimary(primaryCtx);
      for (const f of primaryFindings) kept.push(f);
    }
  }

  // Confidence reflects the final severity and judge verdict, so it is
  // assigned last.
  assignConfidence(kept);

  const pass = kept.every((f) => f.severity !== 'block');
  const result: AuditResult = {
    pass,
    findings: kept,
    generatedAt: new Date().toISOString(),
    detectorVersions,
    detectorSet,
  };
  if (input.agent !== undefined) result.agent = input.agent;
  if (input.pr !== undefined) result.pr = input.pr;
  return result;
}

function applyIntentSeverity(
  findings: Finding[],
  intent: PrIntent,
  policy: 'strict' | 'lenient' | 'off',
): void {
  if (policy === 'off' || !intent.claimsFix) return;
  for (const finding of findings) {
    const upgraded = upgradeSeverity(finding.severity, intent, policy);
    if (upgraded === finding.severity) continue;
    finding.severity = upgraded;
    finding.intentUpgraded = true;
    finding.message =
      `${finding.message} Severity raised because the PR claims a fix ("${intent.evidence}").`;
  }
}

export { testRelaxationDetector } from './test-relaxation';
export { mockOfHallucinationDetector } from './mock-of-hallucination';
export { assertionStripDetector } from './assertion-strip';
export { noOpFixDetector } from './no-op-fix';
export { coverageErosionDetector } from './coverage-erosion';
export { fakeRefactorDetector } from './fake-refactor';
export { commentOnlyFixDetector } from './comment-only-fix';
export { errorSwallowDetector } from './error-swallow';
export { exceptionRethrowLostContextDetector } from './exception-rethrow-lost-context';
export { deadBranchInsertionDetector } from './dead-branch-insertion';
export type { Detector } from './detector-types';
export {
  DEFAULT_DETECTORS,
  EXPERIMENTAL_DETECTORS,
  parseDetectorSet,
  resolveDetectors,
  type DetectorSet,
} from './detector-sets';
