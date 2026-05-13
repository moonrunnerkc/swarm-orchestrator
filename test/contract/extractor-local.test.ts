import { strict as assert } from 'node:assert';
import { LocalExtractor } from '../../src/contract/extractor/local-extractor';
import {
  type BackendRequest,
  type BackendResponse,
  type BackendStreamObserver,
  type BackendStreamResult,
  type LocalBackend,
  type SupportedGrammar,
} from '../../src/inference/local/backend';
import { type RepoContext } from '../../src/contract/types';

class FakeBackend implements LocalBackend {
  readonly name = 'fake';
  public lastRequest: BackendRequest | null = null;
  constructor(
    private readonly responseText: string,
    private readonly grammars: readonly SupportedGrammar[] = ['json-schema', 'none'],
  ) {}
  supportsGrammar(): readonly SupportedGrammar[] {
    return this.grammars;
  }
  async chat(request: BackendRequest): Promise<BackendResponse> {
    this.lastRequest = request;
    return {
      text: this.responseText,
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1 },
      usageEstimated: false,
    };
  }
  async stream(
    _request: BackendRequest,
    _observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    throw new Error('not used in these tests');
  }
}

const REPO_CTX: RepoContext = {
  repoRoot: '/tmp',
  buildCommand: null,
  testCommand: null,
  language: 'unknown',
};

describe('contract/extractor — LocalExtractor', () => {
  it('parses a JSON-only response into obligations', async () => {
    const backend = new FakeBackend(
      JSON.stringify({ obligations: [{ type: 'test-must-pass', command: 'npm test' }] }),
    );
    const extractor = new LocalExtractor({ backend, model: 'fake-model' });
    const out = await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
    assert.equal(out.obligations.length, 1);
    assert.equal(out.provenance.name, 'local');
    assert.equal(out.provenance.model, 'fake-model');
    assert.ok(backend.lastRequest);
    assert.equal(backend.lastRequest.grammar?.kind, 'json-schema');
  });

  it('strips a leading ```json fence when present', async () => {
    const fenced =
      '```json\n' +
      JSON.stringify({ obligations: [{ type: 'test-must-pass', command: 'npm test' }] }) +
      '\n```';
    const backend = new FakeBackend(fenced);
    const extractor = new LocalExtractor({ backend, model: 'fake-model' });
    const out = await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
    assert.equal(out.obligations.length, 1);
  });

  it('skips grammar when the backend does not support json-schema', async () => {
    const backend = new FakeBackend(
      JSON.stringify({ obligations: [{ type: 'test-must-pass', command: 'npm test' }] }),
      ['gbnf'],
    );
    const extractor = new LocalExtractor({ backend, model: 'fake-model' });
    await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
    assert.ok(backend.lastRequest);
    assert.equal(backend.lastRequest.grammar, undefined);
  });

  it('throws a corrective error when the backend returns non-JSON', async () => {
    const backend = new FakeBackend('Here is your contract...');
    const extractor = new LocalExtractor({ backend, model: 'fake-model' });
    await assert.rejects(
      () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
      /not valid JSON/,
    );
  });

  it('throws when the JSON lacks an obligations array', async () => {
    const backend = new FakeBackend(JSON.stringify({ data: [] }));
    const extractor = new LocalExtractor({ backend, model: 'fake-model' });
    await assert.rejects(
      () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
      /without an obligations array/,
    );
  });
});
