// Normalize the audit pipeline's `Finding` shape into the harness's
// `HarnessFinding`, deriving the judge path and a stable cross-stage key.

import type { Finding } from '../../../src/audit/types';
import type { HarnessFinding, JudgePath } from './types';

function judgePathOf(f: Finding): JudgePath {
  if (f.judgePrimary === true) return 'judge-primary';
  if (f.judgeConfirmed === true) return 'judge-confirm';
  return 'structural';
}

export function findingKey(
  repo: string,
  prNumber: number,
  category: string,
  file: string,
  line: number,
): string {
  return `${repo}#${prNumber}:${category}:${file}:${line}`;
}

export function normalizeFinding(repo: string, prNumber: number, f: Finding): HarnessFinding {
  const line = f.location.line;
  const endLine = f.location.endLine ?? f.location.line;
  const out: HarnessFinding = {
    key: findingKey(repo, prNumber, f.category, f.location.file, line),
    repo,
    prNumber,
    category: f.category,
    severity: f.severity,
    subjectPath: f.location.file,
    hunkIndex: null,
    lineRange: { start: line, end: endLine },
    judgePath: judgePathOf(f),
    message: f.message,
    evidence: f.evidence,
    judgeRationale: f.judgeReasoning ?? null,
  };
  return out;
}

export function normalizeFindings(
  repo: string,
  prNumber: number,
  findings: readonly Finding[],
): HarnessFinding[] {
  return findings.map((f) => normalizeFinding(repo, prNumber, f));
}
