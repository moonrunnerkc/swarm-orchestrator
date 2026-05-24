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
  applyIntentSeverity(findings, intent, config.intentSeverityPolicy);

  const pass = findings.every((f) => f.severity !== 'block');
  const result: AuditResult = {
    pass,
    findings,
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
