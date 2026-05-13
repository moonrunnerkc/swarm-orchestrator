import { strict as assert } from 'node:assert';
import { LocalSession } from '../../src/session/local-session';
import {
  type BackendRequest,
  type BackendResponse,
  type BackendStreamObserver,
  type BackendStreamResult,
  type LocalBackend,
  type SupportedGrammar,
} from '../../src/inference/local/backend';
import { type SessionRequest } from '../../src/session/types';

class FakeBackend implements LocalBackend {
  readonly name = 'fake';
  public lastRequest: BackendRequest | null = null;
  public streamChunks: string[];
  constructor(
    private readonly responseText: string,
    private readonly grammars: readonly SupportedGrammar[] = ['gbnf', 'none'],
    streamChunks: string[] = [],
  ) {
    this.streamChunks = streamChunks;
  }
  supportsGrammar(): readonly SupportedGrammar[] {
    return this.grammars;
  }
  async chat(request: BackendRequest): Promise<BackendResponse> {
    this.lastRequest = request;
    return {
      text: this.responseText,
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 2 },
      usageEstimated: false,
    };
  }
  async stream(
    request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    this.lastRequest = request;
    let partialText = '';
    let aborted = false;
    for (const chunk of this.streamChunks) {
      partialText += chunk;
      if (!observer({ chunk, partialText })) {
        aborted = true;
        break;
      }
    }
    return {
      text: partialText,
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 2 },
      usageEstimated: false,
      aborted,
    };
  }
}

function makeRequest(personaId: string, userMessage = 'do the thing'): SessionRequest {
  return {
    personaId,
    personaSystemSuffix: 'persona-suffix',
    sampling: { temperature: 0, maxTokens: 256 },
    userMessage,
  };
}

describe('session — LocalSession', () => {
  it('renders system content as projectContext + persona suffix', async () => {
    const backend = new FakeBackend('no-op');
    const session = new LocalSession({
      projectContext: 'CTX',
      backend,
      model: 'fake-model',
    });
    await session.complete(makeRequest('architect'));
    assert.ok(backend.lastRequest);
    const sys = backend.lastRequest.messages[0];
    assert.equal(sys?.role, 'system');
    assert.ok(sys?.content.startsWith('CTX'));
    assert.ok(sys?.content.includes('persona-suffix'));
  });

  it('reports gbnf as the resolved grammar when the backend supports it', async () => {
    const backend = new FakeBackend('no-op', ['gbnf']);
    const session = new LocalSession({
      projectContext: 'CTX',
      backend,
      model: 'fake-model',
    });
    await session.complete(makeRequest('architect'));
    assert.equal(session.providerInfo().grammar, 'gbnf');
    assert.equal(backend.lastRequest?.grammar?.kind, 'gbnf');
  });

  it('falls back to no grammar when the backend supports none', async () => {
    const backend = new FakeBackend('no-op', ['none']);
    const session = new LocalSession({
      projectContext: 'CTX',
      backend,
      model: 'fake-model',
    });
    await session.complete(makeRequest('architect'));
    assert.equal(session.providerInfo().grammar, 'none');
    assert.equal(backend.lastRequest?.grammar?.kind, 'none');
  });

  it('routes models via personaModelMap', async () => {
    const backend = new FakeBackend('no-op');
    const session = new LocalSession({
      projectContext: 'CTX',
      backend,
      model: 'default-model',
      personaModelMap: { architect: 'arch-model' },
    });
    await session.complete(makeRequest('architect'));
    assert.equal(backend.lastRequest?.model, 'arch-model');
    await session.complete(makeRequest('implementer'));
    assert.equal(backend.lastRequest?.model, 'default-model');
  });

  it('accumulates usage across calls', async () => {
    const backend = new FakeBackend('no-op');
    const session = new LocalSession({ projectContext: 'CTX', backend, model: 'm' });
    await session.complete(makeRequest('p'));
    await session.complete(makeRequest('p'));
    const total = session.totalUsage();
    assert.equal(total.inputTokens, 2);
    assert.equal(total.outputTokens, 4);
  });

  it('forwards stream chunks to the observer in order', async () => {
    const backend = new FakeBackend('', ['gbnf'], ['ab', 'cd', 'ef']);
    const session = new LocalSession({ projectContext: 'CTX', backend, model: 'm' });
    const seen: string[] = [];
    const result = await session.stream(makeRequest('p'), (event) => {
      seen.push(event.chunk);
      return { kind: 'continue' };
    });
    assert.deepEqual(seen, ['ab', 'cd', 'ef']);
    assert.equal(result.aborted, false);
    assert.equal(result.response.text, 'abcdef');
  });

  it('honors a mid-stream abort', async () => {
    const backend = new FakeBackend('', ['gbnf'], ['ab', 'cd', 'ef']);
    const session = new LocalSession({ projectContext: 'CTX', backend, model: 'm' });
    const result = await session.stream(makeRequest('p'), () => ({
      kind: 'abort',
      reason: 'test',
    }));
    assert.equal(result.aborted, true);
    assert.equal(result.abortReason, 'test');
  });
});
