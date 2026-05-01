import type {
  Finding,
  FindingProducerId,
  FindingSeverity,
  LineFinding,
} from '../types/finding';

export type BodyFindingReason = 'low-severity' | 'file-scoped' | 'summary-scoped' | 'outside-diff';

export interface BodyFinding {
  finding: Finding;
  reason: BodyFindingReason;
}

interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
}

function severityLabel(severity: FindingSeverity): string {
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  return 'Low';
}

function emptyCounts(): SeverityCounts {
  return { high: 0, medium: 0, low: 0 };
}

function countsByProducer(findings: Finding[]): Map<FindingProducerId, SeverityCounts> {
  const counts = new Map<FindingProducerId, SeverityCounts>();
  for (const finding of findings) {
    const current = counts.get(finding.producerId) ?? emptyCounts();
    current[finding.severity] += 1;
    counts.set(finding.producerId, current);
  }
  return counts;
}

function reportUrlFor(finding: Finding, fullReportUrl: string | undefined): string | undefined {
  return finding.evidenceUrl ?? fullReportUrl;
}

function codeFenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const size = Math.max(3, ...runs.map(run => run.length + 1));
  return '`'.repeat(size);
}

function formatLocation(finding: Finding): string {
  if (finding.scope === 'line') return `${finding.filePath}:${finding.line}`;
  if (finding.scope === 'file') return finding.filePath;
  return 'summary';
}

function reasonLabel(reason: BodyFindingReason): string {
  if (reason === 'low-severity') return 'low severity';
  if (reason === 'file-scoped') return 'file scoped';
  if (reason === 'summary-scoped') return 'summary scoped';
  return 'outside diff';
}

/**
 * Classify a finding that should be represented in the review summary body.
 *
 * @param finding - Finding that cannot be posted as an inline review comment.
 * @returns Human-readable summary bucket for the finding.
 */
export function bodyReason(finding: Finding): BodyFindingReason {
  if (finding.scope === 'file') return 'file-scoped';
  if (finding.scope === 'summary') return 'summary-scoped';
  return 'low-severity';
}

/**
 * Format the markdown body for one inline GitHub review comment.
 *
 * @param finding - Line-scoped finding to render.
 * @param relocated - Whether the resolver had to anchor near the original line.
 * @param fullReportUrl - Optional run-level report URL.
 * @returns Markdown for the GitHub review comment body.
 */
export function formatReviewCommentBody(
  finding: LineFinding,
  relocated: boolean,
  fullReportUrl?: string,
): string {
  const lines = [`${severityLabel(finding.severity)} \`${finding.ruleId}\`: ${finding.message}`];
  if (relocated) {
    lines.push(`Anchored near original line ${finding.line} because that line is outside the diff hunk.`);
  }
  const reportUrl = reportUrlFor(finding, fullReportUrl);
  if (reportUrl) lines.push(`[See full report](${reportUrl})`);
  if (finding.suggestedEdit) {
    const fence = codeFenceFor(finding.suggestedEdit);
    lines.push(`${fence}suggestion`);
    lines.push(finding.suggestedEdit);
    lines.push(fence);
  }
  return lines.join('\n');
}

/**
 * Build the top-level GitHub review summary body.
 *
 * @param findings - All findings from the verification battery.
 * @param bodyFindings - Findings that are intentionally represented in the body.
 * @param fullReportUrl - Optional run-level report URL.
 * @returns Markdown review summary.
 */
export function buildReviewBody(
  findings: Finding[],
  bodyFindings: BodyFinding[],
  fullReportUrl?: string,
): string {
  const lines = ['## Swarm verification review', ''];
  lines.push(`Findings: ${findings.length}. Inline comments: ${findings.length - bodyFindings.length}.`);
  if (fullReportUrl) lines.push(`Full report: [open report](${fullReportUrl}).`);
  lines.push('', '### Counts by layer', '');
  lines.push('| Layer | High | Medium | Low | Total |');
  lines.push('| --- | ---: | ---: | ---: | ---: |');
  for (const [producerId, counts] of countsByProducer(findings)) {
    const total = counts.high + counts.medium + counts.low;
    lines.push(`| ${producerId} | ${counts.high} | ${counts.medium} | ${counts.low} | ${total} |`);
  }
  if (findings.length === 0) lines.push('| none | 0 | 0 | 0 | 0 |');

  lines.push('', '### Other findings', '');
  if (bodyFindings.length === 0) {
    lines.push('No file-scoped, summary-scoped, low-severity, or unanchored findings.');
  } else {
    for (const bodyFinding of bodyFindings) {
      const finding = bodyFinding.finding;
      const reportUrl = reportUrlFor(finding, fullReportUrl);
      const reportLink = reportUrl ? ` [full report](${reportUrl})` : '';
      lines.push(
        `- ${severityLabel(finding.severity)} ${reasonLabel(bodyFinding.reason)} `
        + `${formatLocation(finding)} \`${finding.ruleId}\`: ${finding.message}${reportLink}`,
      );
    }
  }

  return lines.join('\n');
}
