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

    describe('local provider misconfiguration (DoD 2: no silent fallback)', () => {
      const origBaseUrl = process.env.LOCAL_LLM_BASE_URL;
      const origBackend = process.env.LOCAL_LLM_BACKEND;
      const origModel = process.env.LOCAL_LLM_MODEL_EXTRACTOR;

      beforeEach(() => {
        delete process.env.LOCAL_LLM_BASE_URL;
        delete process.env.LOCAL_LLM_BACKEND;
        delete process.env.LOCAL_LLM_MODEL_EXTRACTOR;
      });

      afterEach(() => {
        if (origBaseUrl !== undefined) process.env.LOCAL_LLM_BASE_URL = origBaseUrl;
        if (origBackend !== undefined) process.env.LOCAL_LLM_BACKEND = origBackend;
        if (origModel !== undefined) process.env.LOCAL_LLM_MODEL_EXTRACTOR = origModel;
      });

      it('fails loud when local is selected without a backend name', () => {
        assert.throws(
          () =>
            buildExtractor({
              provider: 'local',
              localBaseUrl: 'http://localhost:11434/v1',
              localModel: 'qwen2.5-coder:14b',
            }),
          /no backend specified/,
        );
      });

      it('fails loud when local is selected without a base URL', () => {
        assert.throws(
          () =>
            buildExtractor({
              provider: 'local',
              localBackend: 'ollama',
              localModel: 'qwen2.5-coder:14b',
            }),
          /LOCAL_LLM_BASE_URL is not set/,
        );
      });

      it('fails loud when local is selected without a model id', () => {
        assert.throws(
          () =>
            buildExtractor({
              provider: 'local',
              localBackend: 'ollama',
              localBaseUrl: 'http://localhost:11434/v1',
            }),
          /no model id provided/,
        );
      });
    });
  });
});
