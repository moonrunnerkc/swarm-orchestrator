// Public entry to the cheat-detector engine. `runCheatDetectors`
// accepts an AuditInput (already parsed diff text + repo root + optional
// PR metadata + optional agent attribution) and returns an AuditResult.
//
// New detectors register themselves below; the detector list is the
// only place that needs editing when adding a category. Each detector's
// version pins into the AuditResult.detectorVersions map so downstream
// AIBOM artifacts can attribute findings.

import parseDiff from 'parse-diff';
import type { Detector } from './detector-types';
import type { AuditInput, AuditResult, Finding } from '../types';
import { isAuditSubjectPath } from './subject-paths';
import { buildExcludeMatcher, loadAuditConfig } from './audit-config';
import { parsePrIntent, upgradeSeverity, type PrIntent } from './pr-intent';
import { testRelaxationDetector } from './test-relaxation';
import { mockOfHallucinationDetector } from './mock-of-hallucination';
import { assertionStripDetector } from './assertion-strip';
import { noOpFixDetector } from './no-op-fix';
import { coverageErosionDetector } from './coverage-erosion';
import { fakeRefactorDetector } from './fake-refactor';
import { commentOnlyFixDetector } from './comment-only-fix';
import { errorSwallowDetector } from './error-swallow';
import { exceptionRethrowLostContextDetector } from './exception-rethrow-lost-context';
import { deadBranchInsertionDetector } from './dead-branch-insertion';

export const DETECTORS: readonly Detector[] = [
  testRelaxationDetector,
  mockOfHallucinationDetector,
  assertionStripDetector,
  noOpFixDetector,
  coverageErosionDetector,
  fakeRefactorDetector,
  commentOnlyFixDetector,
  errorSwallowDetector,
  exceptionRethrowLostContextDetector,
  deadBranchInsertionDetector,
];

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
  const ctx = input.pr !== undefined
    ? { files, repoRoot: input.repoRoot, pr: input.pr }
    : { files, repoRoot: input.repoRoot };
  const findings: Finding[] = [];
  const detectorVersions: Record<string, string> = {};
  for (const detector of DETECTORS) {
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
