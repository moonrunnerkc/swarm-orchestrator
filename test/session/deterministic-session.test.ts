import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DeterministicSession,
  validatePatchFormat,
  type ExternalPatchEnvelope,
} from '../../src/session/deterministic-session';
import { type SessionRequest } from '../../src/session/types';

function makeRequest(personaId: string, userMessage = 'do the thing'): SessionRequest {
  return {
    personaId,
    personaSystemSuffix: '',
    sampling: { temperature: 0, maxTokens: 4096 },
    userMessage,
  };
}

const FORMAT_1_PATCH = ['<<<FILE src/x.ts', 'export const x = 1;', 'FILE>>>'].join('\n');
const FORMAT_2_PATCH = [
  '--- a/src/x.ts',
  '+++ b/src/x.ts',
  '@@ -1 +1 @@',
  '-export const x = 0;',
  '+export const x = 1;',
].join('\n');
const FORMAT_3_PATCH = 'no-op';

describe('session — validatePatchFormat', () => {
  it('accepts FORMAT 1 whole-file blocks', () => {
    const r = validatePatchFormat(FORMAT_1_PATCH);
    assert.equal(r.valid, true);
    assert.equal(r.format, 'format-1-whole-file');
  });

  it('accepts FORMAT 2 unified diffs', () => {
    const r = validatePatchFormat(FORMAT_2_PATCH);
    assert.equal(r.valid, true);
    assert.equal(r.format, 'format-2-unified-diff');
  });

  it('accepts FORMAT 3 literal no-op', () => {
    assert.equal(validatePatchFormat('no-op').format, 'format-3-no-op');
    assert.equal(validatePatchFormat('  no-op\n').format, 'format-3-no-op');
  });

  it('rejects prose preamble before a diff', () => {
    const r = validatePatchFormat('Here is the diff:\n--- a/x.ts\n+++ b/x.ts\n');
    assert.equal(r.valid, false);
  });

  it('rejects markdown fences around a diff', () => {
    const r = validatePatchFormat('```diff\n--- a/x.ts\n+++ b/x.ts\n```');
    assert.equal(r.valid, false);
  });

  it('rejects an unbalanced FORMAT 1 block', () => {
    const r = validatePatchFormat('<<<FILE src/x.ts\nbody\n');
    assert.equal(r.valid, false);
    assert.match(r.reason ?? '', /not balanced/);
  });

  it('rejects an empty string', () => {
    const r = validatePatchFormat('');
    assert.equal(r.valid, false);
  });
});

describe('session — DeterministicSession (preloaded)', () => {
  it('returns zero usage on every counter', () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [{ patch: FORMAT_3_PATCH }],
    });
    const u = session.totalUsage();
    assert.equal(u.inputTokens, 0);
    assert.equal(u.cacheReadTokens, 0);
    assert.equal(u.cacheCreationTokens, 0);
    assert.equal(u.outputTokens, 0);
  });

  it('emits preloaded envelopes in order on complete()', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [
        { patch: FORMAT_3_PATCH, source: 'first' },
        { patch: FORMAT_1_PATCH, source: 'second' },
      ],
    });
    const a = await session.complete(makeRequest('architect'));
    const b = await session.complete(makeRequest('implementer'));
    assert.equal(a.text.trim(), 'no-op');
    assert.equal(b.text, FORMAT_1_PATCH);
    assert.equal(session.totalUsage().outputTokens, 0);
  });

  it('routes envelopes by persona when tagged', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [
        { patch: FORMAT_1_PATCH, persona: 'implementer' },
        { patch: FORMAT_3_PATCH, persona: 'architect' },
      ],
    });
    const arch = await session.complete(makeRequest('architect'));
    const impl = await session.complete(makeRequest('implementer'));
    assert.equal(arch.text.trim(), 'no-op');
    assert.equal(impl.text, FORMAT_1_PATCH);
  });

  it('rejects a malformed patch before the verifier ever sees it', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [{ patch: 'Here is the diff:\n--- a/x.ts\n+++ b/x.ts\n', source: 'bad' }],
      externalPatchesTimeoutMs: 100,
    });
    await assert.rejects(() => session.complete(makeRequest('architect')), /rejected external patch/);
  });

  it('times out when no envelope is available', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [],
      externalPatchesTimeoutMs: 50,
    });
    await assert.rejects(() => session.complete(makeRequest('architect')), /no external patch envelope/);
  });

  it('emits patches through the stream observer in order', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [{ patch: FORMAT_1_PATCH }],
    });
    const chunks: string[] = [];
    const result = await session.stream(makeRequest('architect'), (event) => {
      chunks.push(event.chunk);
      return { kind: 'continue' };
    });
    assert.equal(result.aborted, false);
    assert.equal(chunks.join(''), FORMAT_1_PATCH);
  });

  it('honors a mid-stream abort', async () => {
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'stdin' },
      preloaded: [{ patch: FORMAT_1_PATCH }],
      streamChunkSize: 4,
    });
    const result = await session.stream(makeRequest('architect'), () => ({
      kind: 'abort',
      reason: 'test',
    }));
    assert.equal(result.aborted, true);
    assert.equal(result.abortReason, 'test');
    assert.ok(
      result.response.text.length < FORMAT_1_PATCH.length,
      `expected partial text length < ${FORMAT_1_PATCH.length}; got ${result.response.text.length}`,
    );
  });
});

describe('session — DeterministicSession (directory channel)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-session-dir-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads envelopes from a watched directory in lexicographic order', async () => {
    const envelopes: ExternalPatchEnvelope[] = [
      { patch: FORMAT_3_PATCH, source: 'a' },
      { patch: FORMAT_1_PATCH, source: 'b' },
    ];
    fs.writeFileSync(path.join(tmpDir, '01.json'), JSON.stringify(envelopes[0]));
    fs.writeFileSync(path.join(tmpDir, '02.json'), JSON.stringify(envelopes[1]));
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'dir', path: tmpDir },
    });
    const a = await session.complete(makeRequest('p1'));
    const b = await session.complete(makeRequest('p1'));
    assert.equal(a.text.trim(), 'no-op');
    assert.equal(b.text, FORMAT_1_PATCH);
    // Consumed files should have been moved to the consumed/ subdir.
    assert.equal(fs.existsSync(path.join(tmpDir, '01.json')), false);
    assert.equal(fs.existsSync(path.join(tmpDir, 'consumed', '01.json')), true);
  });

  it('reports a useful error for a malformed file', async () => {
    fs.writeFileSync(path.join(tmpDir, '01.json'), '{ broken json');
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'dir', path: tmpDir },
      externalPatchesTimeoutMs: 100,
    });
    await assert.rejects(() => session.complete(makeRequest('p1')), /failed to parse patch file/);
  });
});

describe('session — DeterministicSession (queue channel)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-session-queue-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads JSONL envelopes from a queue file', async () => {
    const queue = path.join(tmpDir, 'queue.jsonl');
    fs.writeFileSync(
      queue,
      [
        JSON.stringify({ patch: FORMAT_3_PATCH }),
        JSON.stringify({ patch: FORMAT_1_PATCH }),
        '',
      ].join('\n'),
    );
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'queue', path: queue },
    });
    const a = await session.complete(makeRequest('p'));
    const b = await session.complete(makeRequest('p'));
    assert.equal(a.text.trim(), 'no-op');
    assert.equal(b.text, FORMAT_1_PATCH);
  });

  it('reports a useful error for a malformed line', async () => {
    const queue = path.join(tmpDir, 'queue.jsonl');
    fs.writeFileSync(queue, '{ not json\n');
    const session = new DeterministicSession({
      projectContext: 'ctx',
      source: { kind: 'queue', path: queue },
      externalPatchesTimeoutMs: 100,
    });
    await assert.rejects(() => session.complete(makeRequest('p')), /failed to parse queue line/);
  });
});
