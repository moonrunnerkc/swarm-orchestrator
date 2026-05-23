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
import { testRelaxationDetector } from './test-relaxation';
import { mockOfHallucinationDetector } from './mock-of-hallucination';
import { assertionStripDetector } from './assertion-strip';
import { noOpFixDetector } from './no-op-fix';

export const DETECTORS: readonly Detector[] = [
  testRelaxationDetector,
  mockOfHallucinationDetector,
  assertionStripDetector,
  noOpFixDetector,
];

export function runCheatDetectors(input: AuditInput): AuditResult {
  const files = parseDiff(input.unifiedDiff);
  const ctx = { files, repoRoot: input.repoRoot };
  const findings: Finding[] = [];
  const detectorVersions: Record<string, string> = {};
  for (const detector of DETECTORS) {
    detectorVersions[detector.name] = detector.version;
    for (const finding of detector.run(ctx)) {
      findings.push(finding);
    }
  }
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

export { testRelaxationDetector } from './test-relaxation';
export { mockOfHallucinationDetector } from './mock-of-hallucination';
export { assertionStripDetector } from './assertion-strip';
export { noOpFixDetector } from './no-op-fix';
export type { Detector } from './detector-types';
