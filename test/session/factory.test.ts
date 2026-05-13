import { strict as assert } from 'node:assert';
import { buildSession, resolveSessionProvider } from '../../src/session/factory';
import { DeterministicSession } from '../../src/session/deterministic-session';
import { AnthropicSession } from '../../src/session/anthropic-session';

describe('session — factory', () => {
  describe('resolveSessionProvider', () => {
    const originalEnv = process.env.SESSION_PROVIDER;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.SESSION_PROVIDER;
      else process.env.SESSION_PROVIDER = originalEnv;
    });

    it('defaults to deterministic', () => {
      delete process.env.SESSION_PROVIDER;
      assert.equal(resolveSessionProvider(null), 'deterministic');
    });

    it('honors SESSION_PROVIDER when the flag is null', () => {
      process.env.SESSION_PROVIDER = 'anthropic';
      assert.equal(resolveSessionProvider(null), 'anthropic');
    });

    it('prefers the flag over the env var', () => {
      process.env.SESSION_PROVIDER = 'anthropic';
      assert.equal(resolveSessionProvider('local'), 'local');
    });

    it('rejects an unknown provider', () => {
      assert.throws(() => resolveSessionProvider('grpc'), /expected one of/);
    });

    it('rejects the legacy stub provider name', () => {
      delete process.env.SESSION_PROVIDER;
      assert.throws(
        () => resolveSessionProvider('stub'),
        /invalid session provider "stub"/,
      );
    });
  });

  describe('buildSession', () => {
    it('returns DeterministicSession when a patch source is supplied', () => {
      const s = buildSession({
        provider: 'deterministic',
        projectContext: 'ctx',
        preloadedPatches: [{ patch: 'no-op' }],
      });
      assert.ok(s instanceof DeterministicSession);
    });

    it('fails loud when deterministic is selected without any patch source', () => {
      assert.throws(
        () => buildSession({ provider: 'deterministic', projectContext: 'ctx' }),
        /no patch source provided/,
      );
    });

    it('fails loud when anthropic is selected without an API key', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        assert.throws(
          () => buildSession({ provider: 'anthropic', projectContext: 'ctx' }),
          /ANTHROPIC_API_KEY is not set/,
        );
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it('returns AnthropicSession when an API key is provided', () => {
      const s = buildSession({
        provider: 'anthropic',
        projectContext: 'ctx',
        apiKey: 'sk-test',
      });
      assert.ok(s instanceof AnthropicSession);
    });
  });
});
