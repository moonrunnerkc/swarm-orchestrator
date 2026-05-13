import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AnthropicSession } from '../../src/session/anthropic-session';
import {
  DeterministicSession,
  type ExternalPatchEnvelope,
} from '../../src/session/deterministic-session';
import { LocalSession } from '../../src/session/local-session';
import type {
  Session,
  SessionRequest,
  SessionStreamEvent,
  StreamDecision,
} from '../../src/session/types';
import type {
  BackendOptions,
  BackendRequest,
  BackendResponse,
  BackendStreamObserver,
  BackendStreamResult,
  LocalBackend,
  SupportedGrammar,
} from '../../src/inference/local/backend';
import {
  LOCAL_BACKEND_NAMES,
  type LocalBackendName,
} from '../../src/inference/local/factory';

/**
 * Parameterized contract battery exercised against every Session
 * implementation. Three sessions go through the same suite of
 * assertions; the local session re-runs the full battery for each of
 * the four shipped backend codepaths, with a backend-shaped fake
 * standing in for real HTTP. The point: a provider that passes this
 * suite is interchangeable at the Session boundary; any future provider
 * that wants to claim Session conformance must also pass it.
 */

interface ProviderUnderTest {
  name: string;
  build: () => { session: Session; expectedProvider: string };
}

function withTempQueue(envelopes: readonly ExternalPatchEnvelope[]): {
  cleanup: () => void;
  build: () => DeterministicSession;
  expectedProvider: 'deterministic';
} {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'session-contract-'));
  const queuePath = path.join(tmp, 'queue.jsonl');
  fs.writeFileSync(
    queuePath,
    envelopes.map((e) => JSON.stringify(e)).join('\n') + (envelopes.length > 0 ? '\n' : ''),
  );
  return {
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
    build: (): DeterministicSession =>
      new DeterministicSession({
        projectContext: 'CTX',
        source: { kind: 'queue', path: queuePath },
        externalPatchesTimeoutMs: 100,
      }),
    expectedProvider: 'deterministic',
  };
}

class FakeAnthropicClient {
  constructor(private readonly text: string) {}
  readonly messages = {
    create: async (): Promise<unknown> => ({
      content: [{ type: 'text', text: this.text }],
      usage: {
        input_tokens: 5,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 10,
      },
      model: 'claude-fake',
      stop_reason: 'end_turn',
    }),
    // Simulated streaming: walk over a 2-char chunked iteration so the
    // observer is invoked multiple times. Supports observer abort via
    // `stream.controller.abort()` semantics with an external flag.
    stream: (): {
      [Symbol.asyncIterator]: () => AsyncIterator<unknown>;
      controller: { abort: () => void };
      finalMessage: () => Promise<unknown>;
    } => {
      const chunks: string[] = [];
      for (let i = 0; i < this.text.length; i += 2) chunks.push(this.text.slice(i, i + 2));
      let aborted = false;
      const text = this.text;
      return {
        controller: {
          abort: (): void => {
            aborted = true;
          },
        },
        async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
          for (const c of chunks) {
            if (aborted) return;
            yield {
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: c },
            };
          }
        },
        finalMessage: async (): Promise<unknown> => ({
          content: [{ type: 'text', text }],
          usage: {
            input_tokens: 5,
            output_tokens: 1,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 10,
          },
          model: 'claude-fake',
          stop_reason: aborted ? null : 'end_turn',
        }),
      };
    },
  };
}

class FakeLocalBackend implements LocalBackend {
  constructor(
    readonly name: LocalBackendName,
    private readonly text: string,
    private readonly grammars: readonly SupportedGrammar[],
  ) {}
  async chat(_request: BackendRequest): Promise<BackendResponse> {
    return {
      text: this.text,
      usage: {
        inputTokens: 4,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: this.text.length,
      },
      usageEstimated: false,
    };
  }
  async stream(
    _request: BackendRequest,
    observer: BackendStreamObserver,
  ): Promise<BackendStreamResult> {
    let partial = '';
    let aborted = false;
    for (let i = 0; i < this.text.length; i += 2) {
      const chunk = this.text.slice(i, i + 2);
      partial += chunk;
      const keepGoing = observer({ chunk, partialText: partial });
      if (!keepGoing) {
        aborted = true;
        break;
      }
    }
    return {
      text: partial,
      usage: {
        inputTokens: 4,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: partial.length,
      },
      usageEstimated: false,
      aborted,
    };
  }
  supportsGrammar(): readonly SupportedGrammar[] {
    return this.grammars;
  }
}

const FAKE_PATCH = [
  '--- /dev/null',
  '+++ b/src/added.ts',
  '@@ -0,0 +1,1 @@',
  '+export const x = 1;',
  '',
].join('\n');

const PROVIDERS: ProviderUnderTest[] = [];

PROVIDERS.push({
  name: 'deterministic',
  build: () => {
    const ctx = withTempQueue([{ patch: FAKE_PATCH, source: 'test' }]);
    return { session: ctx.build(), expectedProvider: 'deterministic' };
  },
});

for (const backendName of LOCAL_BACKEND_NAMES) {
  PROVIDERS.push({
    name: `local-${backendName}`,
    build: () => {
      const fake = new FakeLocalBackend(
        backendName,
        FAKE_PATCH,
        backendName === 'llama-cpp' ? ['gbnf'] : ['json-schema'],
      );
      const session = new LocalSession({
        projectContext: 'CTX',
        backend: fake,
        model: 'fake-model',
        grammar: 'none',
        seed: 0,
      });
      return { session, expectedProvider: 'local' };
    },
  });
}

PROVIDERS.push({
  name: 'anthropic',
  build: () => {
    const session = new AnthropicSession({
      apiKey: 'k',
      projectContext: 'CTX',
      client: new FakeAnthropicClient(FAKE_PATCH) as never,
    });
    return { session, expectedProvider: 'anthropic' };
  },
});

const STUB_REQUEST: SessionRequest = {
  personaId: 'architect',
  personaSystemSuffix: 'SUFFIX',
  sampling: { temperature: 0.0, maxTokens: 64 },
  userMessage: 'apply this fixture patch',
};

for (const provider of PROVIDERS) {
  describe(`Session interface contract: ${provider.name}`, () => {
    it('complete() returns a non-empty SessionResponse with the documented shape', async () => {
      const { session } = provider.build();
      const out = await session.complete(STUB_REQUEST);
      assert.equal(typeof out.text, 'string');
      assert.ok(out.text.length > 0, `complete() must not return empty text`);
      assert.equal(typeof out.model, 'string');
      assert.ok(out.usage);
      assert.equal(typeof out.usage.inputTokens, 'number');
      assert.equal(typeof out.usage.cacheReadTokens, 'number');
      assert.equal(typeof out.usage.cacheCreationTokens, 'number');
      assert.equal(typeof out.usage.outputTokens, 'number');
    });

    it('stream() emits chunks in order and ends with the final text observable', async () => {
      const { session } = provider.build();
      const events: SessionStreamEvent[] = [];
      const result = await session.stream(STUB_REQUEST, (event) => {
        events.push(event);
        return { kind: 'continue' };
      });
      assert.ok(events.length > 0, 'stream() must invoke the observer at least once');
      // Chunks accumulate monotonically into partialText.
      for (let i = 1; i < events.length; i += 1) {
        assert.ok(
          (events[i]?.charsObserved ?? 0) >= (events[i - 1]?.charsObserved ?? 0),
          'charsObserved must not decrease',
        );
      }
      assert.equal(result.aborted, false);
      assert.equal(typeof result.response.text, 'string');
      assert.ok(result.response.text.length > 0);
    });

    it('projectContext() returns the prefix the session caches', () => {
      const { session } = provider.build();
      const ctx = session.projectContext();
      assert.equal(typeof ctx, 'string');
      assert.ok(ctx.length > 0);
    });

    it('totalUsage() returns a typed SessionUsage with finite numeric fields even when zero', () => {
      const { session } = provider.build();
      const usage = session.totalUsage();
      assert.equal(typeof usage.inputTokens, 'number');
      assert.equal(typeof usage.cacheReadTokens, 'number');
      assert.equal(typeof usage.cacheCreationTokens, 'number');
      assert.equal(typeof usage.outputTokens, 'number');
      for (const v of Object.values(usage)) {
        assert.ok(Number.isFinite(v as number), 'totalUsage fields must be finite numbers');
      }
    });

    it('a mid-stream abort terminates emission and reports aborted=true', async () => {
      const { session } = provider.build();
      let sawAbort = false;
      const result = await session.stream(STUB_REQUEST, (event): StreamDecision => {
        // Abort on the second observed chunk so we exercise both
        // "continue" and "abort" paths.
        if (event.charsObserved >= 1 && !sawAbort) {
          sawAbort = true;
          return { kind: 'abort', reason: 'contract-test' };
        }
        return { kind: 'continue' };
      });
      assert.equal(result.aborted, true);
      assert.equal(result.abortReason, 'contract-test');
    });

    it('providerInfo() reports a non-empty provider identifier that matches the expected name', () => {
      const { session, expectedProvider } = provider.build();
      const info = session.providerInfo();
      assert.equal(info.provider, expectedProvider);
      assert.equal(typeof info.usageEstimated, 'boolean');
    });
  });
}
