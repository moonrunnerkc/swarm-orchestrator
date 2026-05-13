import { strict as assert } from 'node:assert';
import {
  buildExtractor,
  resolveExtractorProvider,
} from '../../src/contract/extractor/factory';
import { DeterministicExtractor } from '../../src/contract/extractor/deterministic-extractor';
import { AnthropicExtractor } from '../../src/contract/extractor/anthropic-extractor';

describe('contract/extractor — factory', () => {
  describe('resolveExtractorProvider', () => {
    const originalEnv = process.env.EXTRACTOR_PROVIDER;
    afterEach(() => {
      if (originalEnv === undefined) delete process.env.EXTRACTOR_PROVIDER;
      else process.env.EXTRACTOR_PROVIDER = originalEnv;
    });

    it('defaults to deterministic when no flag and no env var are set', () => {
      delete process.env.EXTRACTOR_PROVIDER;
      assert.equal(resolveExtractorProvider(null), 'deterministic');
    });

    it('honors EXTRACTOR_PROVIDER when the flag is null', () => {
      process.env.EXTRACTOR_PROVIDER = 'anthropic';
      assert.equal(resolveExtractorProvider(null), 'anthropic');
    });

    it('prefers the flag over the env var', () => {
      process.env.EXTRACTOR_PROVIDER = 'anthropic';
      assert.equal(resolveExtractorProvider('local'), 'local');
    });

    it('rejects an unknown provider with a corrective message', () => {
      delete process.env.EXTRACTOR_PROVIDER;
      assert.throws(
        () => resolveExtractorProvider('grpc'),
        /expected one of: deterministic, local, anthropic/,
      );
    });

    it('rejects the legacy stub provider name', () => {
      delete process.env.EXTRACTOR_PROVIDER;
      assert.throws(
        () => resolveExtractorProvider('stub'),
        /invalid extractor provider "stub"/,
      );
    });
  });

  describe('buildExtractor', () => {
    it('returns DeterministicExtractor for the inline-contract path', () => {
      const ext = buildExtractor({
        provider: 'deterministic',
        inlineContract: { obligations: [{ type: 'test-must-pass', command: 'npm test' }] },
      });
      assert.ok(ext instanceof DeterministicExtractor);
    });

    it('fails loud when deterministic is selected without any contract input', () => {
      assert.throws(
        () => buildExtractor({ provider: 'deterministic' }),
        /no contract input provided/,
      );
    });

    it('fails loud when anthropic is selected without an API key', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        assert.throws(
          () => buildExtractor({ provider: 'anthropic' }),
          /ANTHROPIC_API_KEY is not set/,
        );
      } finally {
        if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it('returns AnthropicExtractor when an API key is provided', () => {
      const ext = buildExtractor({ provider: 'anthropic', apiKey: 'sk-test' });
      assert.ok(ext instanceof AnthropicExtractor);
    });
  });
});
