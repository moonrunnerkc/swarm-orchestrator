import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import {
  parsePullRequestDiff,
  resolveDiffPosition,
} from './diff-position-resolver';
import type {
  Finding,
  FindingProducerId,
  FindingSeverity,
  LineFinding,
} from '../types/finding';

type CreateReviewParameters = RestEndpointMethodTypes['pulls']['createReview']['parameters'];
type ReviewComment = NonNullable<CreateReviewParameters['comments']>[number];
type ReviewEvent = 'REQUEST_CHANGES' | 'COMMENT';
type BodyFindingReason = 'low-severity' | 'file-scoped' | 'summary-scoped' | 'outside-diff';

interface BodyFinding {
  finding: Finding;
  reason: BodyFindingReason;
}

interface SeverityCounts {
  high: number;
  medium: number;
  low: number;
}

export interface ReviewPosterInput {
  owner: string;
  repo: string;
  pullNumber: number;
  commitSha: string;
  diffText: string;
  findings: Finding[];
  githubToken: string;
  fullReportUrl?: string;
}

export interface PostedPullRequestReview {
  reviewId: number;
  htmlUrl?: string;
  event: ReviewEvent;
  inlineCommentCount: number;
  bodyFindingCount: number;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
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

function reviewEvent(findings: Finding[]): ReviewEvent {
  return findings.some(finding => finding.severity === 'high') ? 'REQUEST_CHANGES' : 'COMMENT';
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

function bodyReason(finding: Finding): BodyFindingReason {
  if (finding.scope === 'file') return 'file-scoped';
  if (finding.scope === 'summary') return 'summary-scoped';
  return 'low-severity';
}

function reasonLabel(reason: BodyFindingReason): string {
  if (reason === 'low-severity') return 'low severity';
  if (reason === 'file-scoped') return 'file scoped';
  if (reason === 'summary-scoped') return 'summary scoped';
  return 'outside diff';
}

function inlineCandidate(finding: Finding): finding is LineFinding {
  return finding.scope === 'line' && finding.severity !== 'low';
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
function buildReviewBody(
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

function validateInput(input: ReviewPosterInput): void {
  if (input.owner.trim() === '') {
    throw new Error('failed to post GitHub review: owner is empty; provide the repository owner');
  }
  if (input.repo.trim() === '') {
    throw new Error('failed to post GitHub review: repo is empty; provide the repository name');
  }
  if (!Number.isInteger(input.pullNumber) || input.pullNumber < 1) {
    throw new Error('failed to post GitHub review: pullNumber must be a positive PR number');
  }
  if (input.commitSha.trim() === '') {
    throw new Error('failed to post GitHub review: commitSha is empty; pass the PR head SHA');
  }
  if (input.githubToken.trim() === '') {
    throw new Error('failed to post GitHub review: githubToken is empty; provide a token with pull-requests:write');
  }
}

/**
 * Post one GitHub pull request review for verification findings.
 *
 * @param input - Repository, pull request, diff, token, and finding details.
 * @returns Metadata for the posted review.
 */
export async function postPullRequestReview(input: ReviewPosterInput): Promise<PostedPullRequestReview> {
  validateInput(input);
  const parsedDiff = parsePullRequestDiff(input.diffText);
  const comments: ReviewComment[] = [];
  const bodyFindings: BodyFinding[] = [];

  for (const finding of input.findings) {
    if (!inlineCandidate(finding)) {
      bodyFindings.push({ finding, reason: bodyReason(finding) });
      continue;
    }

    const resolution = resolveDiffPosition(finding, parsedDiff);
    if (!resolution) {
      bodyFindings.push({ finding, reason: 'outside-diff' });
      continue;
    }

    comments.push({
      path: normalizePath(finding.filePath),
      line: resolution.line,
      side: resolution.side,
      body: formatReviewCommentBody(finding, resolution.relocated, input.fullReportUrl),
    });
  }

  const event = reviewEvent(input.findings);
  const body = buildReviewBody(input.findings, bodyFindings, input.fullReportUrl);
  const octokit = new Octokit({ auth: input.githubToken });
  const payload: CreateReviewParameters = {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
    commit_id: input.commitSha,
    event,
    body,
    comments,
  };
  let response: Awaited<ReturnType<typeof octokit.rest.pulls.createReview>>;
  try {
    response = await octokit.rest.pulls.createReview(payload);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to post GitHub review: GitHub API create review failed (${detail}); `
      + 'verify the token has pull-requests:write and the PR head SHA is current',
      { cause: error },
    );
  }

  return {
    reviewId: response.data.id,
    htmlUrl: response.data.html_url,
    event,
    inlineCommentCount: comments.length,
    bodyFindingCount: bodyFindings.length,
  };
}
