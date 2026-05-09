import { strict as assert } from 'assert';
import type { ObligationV1 } from '../../src/contract/types';
import { StubSession } from '../../src/session/stub-session';
import {
  buildAssertions,
  evaluateAssertions,
  forbiddenImportsAssertion,
  matchesForbiddenImport,
  NULL_STREAMING_CONFIG,
  runStreamingCompletion,
} from '../../src/verification/streaming-verifier';

const FILE_OBLIGATION: ObligationV1 = {
  type: 'file-must-exist',
  path: 'src/health.ts',
};

describe('streaming-verifier (Phase 6)', () => {
  describe('matchesForbiddenImport', () => {
    it('detects a JS / TS quoted import', () => {
      assert.equal(matchesForbiddenImport(`import x from 'doomed-pkg'`, 'doomed-pkg'), true);
      assert.equal(matchesForbiddenImport(`import "doomed-pkg"`, 'doomed-pkg'), true);
      assert.equal(matchesForbiddenImport('require(`doomed-pkg`)', 'doomed-pkg'), true);
    });
    it('detects a JS / TS submodule reference', () => {
      assert.equal(
        matchesForbiddenImport(`import sub from 'doomed-pkg/sub'`, 'doomed-pkg'),
        true,
      );
    });
    it('detects a Python import', () => {
      assert.equal(matchesForbiddenImport(`import doomed_pkg`, 'doomed_pkg'), true);
      assert.equal(
        matchesForbiddenImport(`from doomed_pkg.sub import X`, 'doomed_pkg'),
        true,
      );
    });
    it('does not match unrelated text', () => {
      assert.equal(matchesForbiddenImport(`// the doomed-pkg story`, 'doomed-pkg'), false);
      assert.equal(matchesForbiddenImport(`other-pkg`, 'doomed-pkg'), false);
      assert.equal(matchesForbiddenImport(`importeddoomed_pkg`, 'doomed_pkg'), false);
    });
    it('handles regex-special characters in the name', () => {
      assert.equal(matchesForbiddenImport(`import x from 'a.b'`, 'a.b'), true);
      // Ensure '.' is not treated as wildcard.
      assert.equal(matchesForbiddenImport(`import x from 'aXb'`, 'a.b'), false);
    });
  });

  describe('forbiddenImportsAssertion', () => {
    it('returns null when the partial does not include the forbidden name', () => {
      const a = forbiddenImportsAssertion(['nope']);
      assert.equal(a.evaluate({ obligation: FILE_OBLIGATION, partialText: 'console.log(1)' }), null);
    });
    it('returns the violation reason when a forbidden name appears', () => {
      const a = forbiddenImportsAssertion(['nope']);
      const r = a.evaluate({ obligation: FILE_OBLIGATION, partialText: `import x from 'nope'` });
      assert.ok(r !== null);
      assert.match(r ?? '', /forbidden import "nope"/);
    });
    it('is a no-op when the deny list is empty', () => {
      const a = forbiddenImportsAssertion([]);
      assert.equal(
        a.evaluate({ obligation: FILE_OBLIGATION, partialText: `import x from 'anything'` }),
        null,
      );
      assert.match(a.description, /no entries/);
    });
    it('trims whitespace and skips empty entries', () => {
      const a = forbiddenImportsAssertion([' nope ', '', 'second']);
      assert.match(a.description, /nope, second/);
    });
  });

  describe('evaluateAssertions', () => {
    it('returns null when no assertion fires', () => {
      const out = evaluateAssertions(
        [forbiddenImportsAssertion(['nope'])],
        FILE_OBLIGATION,
        'clean text',
      );
      assert.equal(out, null);
    });
    it('returns the first violating assertion id', () => {
      const out = evaluateAssertions(
        [forbiddenImportsAssertion(['first']), forbiddenImportsAssertion(['second'])],
        FILE_OBLIGATION,
        `import x from 'first'\nimport y from 'second'`,
      );
      assert.ok(out);
      assert.equal(out?.assertionId, 'forbidden-imports');
    });
  });

  describe('buildAssertions', () => {
    it('returns just the forbidden-imports assertion by default', () => {
      const list = buildAssertions({ forbiddenImports: ['x'] });
      assert.equal(list.length, 1);
      assert.equal(list[0]?.id, 'forbidden-imports');
    });
    it('appends extra assertions in order', () => {
      const list = buildAssertions({
        forbiddenImports: [],
        extraAssertions: [
          { id: 'a', description: 'a', evaluate: () => null },
          { id: 'b', description: 'b', evaluate: () => null },
        ],
      });
      assert.deepEqual(list.map((a) => a.id), ['forbidden-imports', 'a', 'b']);
    });
    it('NULL_STREAMING_CONFIG yields a no-op assertion list', () => {
      const list = buildAssertions(NULL_STREAMING_CONFIG);
      // Single forbidden-imports assertion with empty list — never fires.
      assert.equal(list.length, 1);
      assert.equal(
        list[0]?.evaluate({ obligation: FILE_OBLIGATION, partialText: `import x from 'foo'` }),
        null,
      );
    });
  });

  describe('runStreamingCompletion', () => {
    it('completes normally when no assertion fires', async () => {
      const session = new StubSession({
        projectContext: 'CTX',
        responder: () => '```\nclean file body\n```',
        streamChunkSize: 4,
      });
      const outcome = await runStreamingCompletion(
        session,
        {
          personaId: 'architect',
          personaSystemSuffix: 'arch',
          sampling: { temperature: 0.2, maxTokens: 64 },
          userMessage: 'do a thing',
        },
        FILE_OBLIGATION,
        buildAssertions({ forbiddenImports: ['nope'] }),
      );
      assert.equal(outcome.aborted, false);
      assert.equal(outcome.abortAssertionId, null);
      assert.equal(outcome.streamResult.aborted, false);
      assert.match(outcome.streamResult.response.text, /clean file body/);
    });

    it('aborts mid-stream when the verifier flags a partial', async () => {
      const session = new StubSession({
        projectContext: 'CTX',
        // Place the forbidden import early in the stream so the abort
        // fires before the rest of the response is generated.
        responder: () =>
          [
            "import x from 'doomed-pkg'",
            "// remaining body that won't be paid for",
            "console.log('still going')",
          ].join('\n'),
        streamChunkSize: 4,
      });
      const outcome = await runStreamingCompletion(
        session,
        {
          personaId: 'architect',
          personaSystemSuffix: 'arch',
          sampling: { temperature: 0.2, maxTokens: 64 },
          userMessage: 'do a thing',
        },
        FILE_OBLIGATION,
        buildAssertions({ forbiddenImports: ['doomed-pkg'] }),
      );
      assert.equal(outcome.aborted, true);
      assert.equal(outcome.abortAssertionId, 'forbidden-imports');
      assert.match(outcome.abortReason ?? '', /forbidden import "doomed-pkg"/);
      // Partial text contains the doomed import line and stops shortly
      // after — strictly shorter than the full response.
      const fullLength =
        "import x from 'doomed-pkg'\n// remaining body that won't be paid for\nconsole.log('still going')".length;
      assert.ok(outcome.streamResult.response.text.length < fullLength);
      assert.ok(outcome.abortedAtChars > 0);
      assert.ok(outcome.abortedAtChars <= outcome.streamResult.response.text.length);
    });

    it('passes through the full text when the verifier never flags', async () => {
      const session = new StubSession({
        projectContext: 'CTX',
        responder: () => 'no imports anywhere',
        streamChunkSize: 1,
      });
      const outcome = await runStreamingCompletion(
        session,
        {
          personaId: 'architect',
          personaSystemSuffix: 'arch',
          sampling: { temperature: 0.2, maxTokens: 16 },
          userMessage: 'msg',
        },
        FILE_OBLIGATION,
        buildAssertions({ forbiddenImports: ['nope'] }),
      );
      assert.equal(outcome.aborted, false);
      assert.equal(outcome.streamResult.response.text, 'no imports anywhere');
    });
  });

  describe('StubSession.stream', () => {
    it('reports cache write on call 0 and cache read on call 1', async () => {
      const session = new StubSession({
        projectContext: 'static prefix',
        responder: () => 'output',
        streamChunkSize: 32,
      });
      const r1 = await session.stream(
        {
          personaId: 'p',
          personaSystemSuffix: 'sfx',
          sampling: { temperature: 0.2, maxTokens: 16 },
          userMessage: 'm',
        },
        () => ({ kind: 'continue' }),
      );
      assert.equal(r1.aborted, false);
      assert.ok(r1.response.usage.cacheCreationTokens > 0);
      assert.equal(r1.response.usage.cacheReadTokens, 0);

      const r2 = await session.stream(
        {
          personaId: 'p',
          personaSystemSuffix: 'sfx',
          sampling: { temperature: 0.2, maxTokens: 16 },
          userMessage: 'm',
        },
        () => ({ kind: 'continue' }),
      );
      assert.equal(r2.response.usage.cacheCreationTokens, 0);
      assert.ok(r2.response.usage.cacheReadTokens > 0);
    });

    it('honors observer abort and reports partial text', async () => {
      const session = new StubSession({
        projectContext: 'CTX',
        responder: () => 'abcdefghij',
        streamChunkSize: 1,
      });
      const result = await session.stream(
        {
          personaId: 'p',
          personaSystemSuffix: 'sfx',
          sampling: { temperature: 0.2, maxTokens: 16 },
          userMessage: 'm',
        },
        ({ partialText }) =>
          partialText.length >= 3 ? { kind: 'abort', reason: 'enough' } : { kind: 'continue' },
      );
      assert.equal(result.aborted, true);
      assert.equal(result.abortReason, 'enough');
      assert.equal(result.response.text, 'abc');
      assert.equal(result.response.stopReason, 'observer_abort');
    });
  });
});
