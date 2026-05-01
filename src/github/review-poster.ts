import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import {
  parsePullRequestDiff,
  resolveDiffPosition,
} from './diff-position-resolver';
import {
  appendFindingMarker,
  computeFindingId,
  reconcileFindings,
  type ExistingComment,
} from './comment-dedup';
import {
  bodyReason,
  buildReviewBody,
  formatReviewCommentBody,
  type BodyFinding,
} from './comment-body-builder';
import { fetchExistingReviewComments } from './review-comment-fetcher';
import type {
  Finding,
  LineFinding,
} from '../types/finding';

export { formatReviewCommentBody } from './comment-body-builder';

type CreateReviewParameters = RestEndpointMethodTypes['pulls']['createReview']['parameters'];
type ReviewComment = NonNullable<CreateReviewParameters['comments']>[number];
type ReviewEvent = 'REQUEST_CHANGES' | 'COMMENT';
const RESOLUTION_NOTICE = '**Resolved in newer run** — original finding below.';

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

function reviewEvent(findings: Finding[]): ReviewEvent {
  return findings.some(finding => finding.severity === 'high') ? 'REQUEST_CHANGES' : 'COMMENT';
}

function inlineCandidate(finding: Finding): finding is LineFinding {
  return finding.scope === 'line' && finding.severity !== 'low';
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

function buildReviewComments(input: ReviewPosterInput, findingsToPost: Finding[]): {
  comments: ReviewComment[];
  bodyFindings: BodyFinding[];
} {
  const parsedDiff = parsePullRequestDiff(input.diffText);
  const comments: ReviewComment[] = [];
  const bodyFindings: BodyFinding[] = [];

  for (const finding of findingsToPost) {
    if (!inlineCandidate(finding)) {
      bodyFindings.push({ finding, reason: bodyReason(finding) });
      continue;
    }

    const resolution = resolveDiffPosition(finding, parsedDiff);
    if (!resolution) {
      bodyFindings.push({ finding, reason: 'outside-diff' });
      continue;
    }

    const body = formatReviewCommentBody(finding, resolution.relocated, input.fullReportUrl);
    comments.push({
      path: normalizePath(finding.filePath),
      line: resolution.line,
      side: resolution.side,
      body: appendFindingMarker(body, computeFindingId(finding)),
    });
  }

  return { comments, bodyFindings };
}

async function resolveStaleComments(
  octokit: Octokit,
  input: ReviewPosterInput,
  comments: ExistingComment[],
): Promise<void> {
  for (const comment of comments) {
    if (comment.body.startsWith(RESOLUTION_NOTICE)) continue;
    try {
      await octokit.rest.pulls.updateReviewComment({
        owner: input.owner,
        repo: input.repo,
        comment_id: comment.id,
        body: `${RESOLUTION_NOTICE}\n\n${comment.body}`,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `failed to resolve GitHub review comment ${comment.id}: GitHub API update review comment failed (${detail}); `
        + 'verify the token has pull-requests:write and the comment still exists',
        { cause: error },
      );
    }
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
  const octokit = new Octokit({ auth: input.githubToken });
  const existingComments = await fetchExistingReviewComments(octokit, {
    owner: input.owner,
    repo: input.repo,
    pullNumber: input.pullNumber,
  });
  const reconciled = reconcileFindings({
    existingComments,
    currentFindings: input.findings,
  });
  await resolveStaleComments(octokit, input, reconciled.toResolve);
  const { comments, bodyFindings } = buildReviewComments(input, reconciled.toPost);

  const event = reviewEvent(input.findings);
  const body = buildReviewBody(input.findings, bodyFindings, input.fullReportUrl);
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
