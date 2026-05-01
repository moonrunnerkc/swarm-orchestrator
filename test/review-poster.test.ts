import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { postPullRequestReview } from '../src/github/review-poster';
import { createFinding, type Finding, type FindingInput } from '../src/types/finding';

const apiUrl = 'https://api.github.com/repos/:owner/:repo/pulls/:pullNumber/reviews';
const recordedReviewResponse = {
  id: 7788,
  html_url: 'https://github.com/octo/swarm/pull/12#pullrequestreview-7788',
};
const server = setupServer();

function fixture(name: string): string {
  return fs.readFileSync(
    path.join(process.cwd(), 'test', 'fixtures', 'sample-diffs', name),
    'utf8',
  );
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  assert.equal(typeof value, 'object', `${name} should be an object`);
  assert.notEqual(value, null, `${name} should not be null`);
  assert.equal(Array.isArray(value), false, `${name} should not be an array`);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string): unknown[] {
  assert.equal(Array.isArray(value), true, `${name} should be an array`);
  return value as unknown[];
}

function asString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    assert.fail(`${name} should be a string`);
  }
  return value;
}

function captureCreateReviewRequests(captured: Record<string, unknown>[]): void {
  server.use(http.post(apiUrl, async ({ request }) => {
    captured.push(asRecord(await request.json(), 'review request body'));
    return HttpResponse.json(recordedReviewResponse, { status: 201 });
  }));
}

function finding(input: FindingInput): Finding {
  return createFinding(input);
}

describe('review poster', () => {
  before(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  after(() => server.close());

  it('posts line findings as line-side comments and body-scoped findings in the summary', async () => {
    const captured: Record<string, unknown>[] = [];
    captureCreateReviewRequests(captured);
    const findings = [
      finding({
        scope: 'line',
        producerId: 'cheat-detector',
        ruleId: 'hardcoded-answer',
        severity: 'high',
        filePath: 'src/example.ts',
        line: 2,
        message: 'Implementation copied an expected literal from a test.',
        suggestedEdit: 'export const inserted = buildValue();',
      }),
      finding({
        scope: 'line',
        producerId: 'property-gate',
        ruleId: 'generic-property-fuzzing',
        severity: 'low',
        filePath: 'src/example.ts',
        line: 3,
        message: 'Property gate used advisory generic fuzzing for this function.',
      }),
      finding({
        scope: 'file',
        producerId: 'mutation-gate',
        ruleId: 'mutation-score-fail',
        severity: 'high',
        filePath: 'src/example.ts',
        message: 'Mutation score did not meet the configured threshold.',
      }),
      finding({
        scope: 'summary',
        producerId: 'differential-gate',
        ruleId: 'differential-execution-failed',
        severity: 'high',
        message: 'Differential verification could not complete.',
      }),
    ];

    const result = await postPullRequestReview({
      owner: 'octo',
      repo: 'swarm',
      pullNumber: 12,
      commitSha: 'abc1234',
      diffText: fixture('in-hunk.diff'),
      findings,
      githubToken: 'test-token',
      fullReportUrl: 'https://reports.example/swarm/run-1',
    });

    assert.equal(result.reviewId, recordedReviewResponse.id);
    assert.equal(result.htmlUrl, recordedReviewResponse.html_url);
    assert.equal(result.event, 'REQUEST_CHANGES');
    assert.equal(result.inlineCommentCount, 1);
    assert.equal(result.bodyFindingCount, 3);
    assert.equal(captured.length, 1);

    const payload = captured[0];
    assert.equal(payload.owner, undefined);
    assert.equal(payload.commit_id, 'abc1234');
    assert.equal(payload.event, 'REQUEST_CHANGES');
    const comments = asArray(payload.comments, 'comments');
    assert.equal(comments.length, 1);
    const comment = asRecord(comments[0], 'first comment');
    assert.equal(comment.path, 'src/example.ts');
    assert.equal(comment.line, 2);
    assert.equal(comment.side, 'RIGHT');
    assert.equal(Object.prototype.hasOwnProperty.call(comment, 'position'), false);
    const commentBody = asString(comment.body, 'comment body');
    assert.match(commentBody, /High `hardcoded-answer`: Implementation copied an expected literal/);
    assert.match(commentBody, /```suggestion\nexport const inserted = buildValue\(\);\n```/);

    const reviewBody = asString(payload.body, 'review body');
    assert.match(reviewBody, /\| cheat-detector \| 1 \| 0 \| 0 \| 1 \|/);
    assert.match(reviewBody, /Low low severity src\/example\.ts:3 `generic-property-fuzzing`/);
    assert.match(reviewBody, /High file scoped src\/example\.ts `mutation-score-fail`/);
    assert.match(reviewBody, /High summary scoped summary `differential-execution-failed`/);
    assert.match(reviewBody, /\[open report\]\(https:\/\/reports\.example\/swarm\/run-1\)/);
  });

  it('uses COMMENT reviews and records relocated anchors in inline comment bodies', async () => {
    const captured: Record<string, unknown>[] = [];
    captureCreateReviewRequests(captured);
    const findings = [
      finding({
        scope: 'line',
        producerId: 'property-gate',
        ruleId: 'property-counterexample',
        severity: 'medium',
        filePath: 'src/example.ts',
        line: 14,
        message: 'Property-based test found a counterexample in normalize.',
      }),
    ];

    const result = await postPullRequestReview({
      owner: 'octo',
      repo: 'swarm',
      pullNumber: 12,
      commitSha: 'def5678',
      diffText: fixture('near-hunk.diff'),
      findings,
      githubToken: 'test-token',
    });

    assert.equal(result.event, 'COMMENT');
    assert.equal(result.inlineCommentCount, 1);
    assert.equal(result.bodyFindingCount, 0);
    const payload = captured[0];
    assert.equal(payload.event, 'COMMENT');
    const comments = asArray(payload.comments, 'comments');
    const comment = asRecord(comments[0], 'first comment');
    assert.equal(comment.line, 10);
    assert.equal(comment.side, 'RIGHT');
    assert.match(asString(comment.body, 'comment body'), /Anchored near original line 14/);
  });
});
