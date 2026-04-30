import { strict as assert } from 'assert';

import { classifyFatalAgentError } from '../src/adapters/fatal-error-classifier';

describe('fatal-error-classifier', () => {
  describe('classifyFatalAgentError', () => {
    it('flags codex usage-limit message verbatim from the smoke run', () => {
      const stderr = [
        '2026-04-29T00:47:30.123Z INFO codex_cli::main: starting',
        "ERROR: You've hit your usage limit. Upgrade to Pro for higher limits or try again at 10:20 PM.",
        '2026-04-29T00:47:45.630381Z ERROR codex_core::session: failed to record rollout items',
      ].join('\n');
      const result = classifyFatalAgentError('', stderr, 1);
      assert.ok(result, 'expected a fatal error to be detected');
      assert.equal(result!.kind, 'usage-limit');
      assert.match(result!.message, /usage limit/i);
    });

    it('flags 401 unauthorized as auth', () => {
      const result = classifyFatalAgentError('', '401 Unauthorized: missing token', 1);
      assert.ok(result);
      assert.equal(result!.kind, 'auth');
    });

    it('flags missing api key as auth', () => {
      const result = classifyFatalAgentError('', 'OPENAI_API_KEY is not set', 1);
      assert.ok(result);
      assert.equal(result!.kind, 'auth');
    });

    it('flags extended retry-after windows as rate-limit-extended', () => {
      const result = classifyFatalAgentError('', 'rate limit reached. retry-after: 3600', 1);
      assert.ok(result);
      assert.equal(result!.kind, 'rate-limit-extended');
    });

    it('returns undefined when the agent exited successfully', () => {
      const stderr = "ERROR: You've hit your usage limit";
      const result = classifyFatalAgentError('', stderr, 0);
      assert.equal(result, undefined, 'a successful exit should not be classified as fatal');
    });

    it('returns undefined for transient errors that are not account-level', () => {
      const stderr = 'fatal: unable to access remote: 503 Service Unavailable';
      const result = classifyFatalAgentError('', stderr, 1);
      assert.equal(result, undefined, '503 is recoverable; should not abort the sweep');
    });

    it('returns undefined when both streams are empty', () => {
      assert.equal(classifyFatalAgentError('', '', 1), undefined);
    });

    it('captures the matching line as evidence for postmortem reports', () => {
      const stderr = [
        'starting subprocess',
        'authentication required',
        'exiting',
      ].join('\n');
      const result = classifyFatalAgentError('', stderr, 1);
      assert.ok(result);
      assert.equal(result!.evidence, 'authentication required');
    });
  });
});
