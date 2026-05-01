import { Octokit } from '@octokit/rest';
import {
  parseFindingId,
  type ExistingComment,
} from './comment-dedup';

export interface FetchExistingReviewCommentsInput {
  owner: string;
  repo: string;
  pullNumber: number;
}

/**
 * Fetch existing PR review comments and parse swarm finding markers.
 *
 * @param octokit - Authenticated Octokit REST client.
 * @param input - Repository and pull request identity.
 * @returns Existing GitHub review comments with parsed finding ids when present.
 */
export async function fetchExistingReviewComments(
  octokit: Octokit,
  input: FetchExistingReviewCommentsInput,
): Promise<ExistingComment[]> {
  try {
    const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner: input.owner,
      repo: input.repo,
      pull_number: input.pullNumber,
      per_page: 100,
    });
    return comments.map(comment => ({
      id: comment.id,
      body: comment.body,
      findingId: parseFindingId(comment.body),
    }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to fetch GitHub review comments: GitHub API list review comments failed (${detail}); `
      + 'verify the token has pull-requests:read access and the PR number is correct',
      { cause: error },
    );
  }
}
