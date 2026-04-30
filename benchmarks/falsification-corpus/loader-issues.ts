export interface CorpusStructureIssue {
  runDir: string;
  phase: string;
  reason: string;
  remediation: string;
}

/** Creates a structured corpus-loader issue with remediation guidance. */
export function createCorpusIssue(
  runDir: string,
  phase: string,
  reason: string,
  remediation: string,
): CorpusStructureIssue {
  return { runDir, phase, reason, remediation };
}

/** Formats loader issues for a halting error message. */
export function formatIssueMessage(issues: readonly CorpusStructureIssue[]): string {
  return [
    `Corpus loader found ${issues.length} invalid verification-run artifact(s):`,
    ...issues.map(item => `${item.runDir} [${item.phase}]: ${item.reason} Remediation: ${item.remediation}`),
  ].join('\n');
}
