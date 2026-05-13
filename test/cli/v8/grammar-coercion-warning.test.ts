import { strict as assert } from 'assert';
import * as path from 'path';
import { handleCompile } from '../../../src/cli/v8/compile-handler';

/**
 * End-to-end assertion that the `--local-grammar` coercion warning lands
 * on stderr (not stdout) when the user supplies a value the extractor
 * cannot honor. We exercise the compile handler with `--extractor local`
 * but without a configured backend so the factory throws fast — the
 * warning has already been written by then.
 */

const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'v8-empty');

interface Captured {
  stderr: string;
  stdout: string;
}

async function captureStdio(fn: () => Promise<number>): Promise<{ exit: number; io: Captured }> {
  const io: Captured = { stderr: '', stdout: '' };
  const realErr = process.stderr.write.bind(process.stderr);
  const realOut = process.stdout.write.bind(process.stdout);
  type WriteFn = typeof process.stderr.write;
  const captureErr: WriteFn = ((chunk: unknown): boolean => {
    io.stderr += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as WriteFn;
  const captureOut: WriteFn = ((chunk: unknown): boolean => {
    io.stdout += typeof chunk === 'string' ? chunk : String(chunk);
    return true;
  }) as WriteFn;
  process.stderr.write = captureErr;
  process.stdout.write = captureOut;
  try {
    const exit = await fn();
    return { exit, io };
  } finally {
    process.stderr.write = realErr;
    process.stdout.write = realOut;
  }
}

describe('cli/v8/compile-handler grammar coercion warning', () => {
  // Pre-clear env vars that would otherwise satisfy the local factory and
  // let the run reach the network. We want the factory to fail fast AFTER
  // the warning is emitted.
  let savedBackend: string | undefined;
  let savedBaseUrl: string | undefined;
  let savedModelExtractor: string | undefined;
  beforeEach(() => {
    savedBackend = process.env.LOCAL_LLM_BACKEND;
    savedBaseUrl = process.env.LOCAL_LLM_BASE_URL;
    savedModelExtractor = process.env.LOCAL_LLM_MODEL_EXTRACTOR;
    delete process.env.LOCAL_LLM_BACKEND;
    delete process.env.LOCAL_LLM_BASE_URL;
    delete process.env.LOCAL_LLM_MODEL_EXTRACTOR;
  });
  afterEach(() => {
    if (savedBackend === undefined) delete process.env.LOCAL_LLM_BACKEND;
    else process.env.LOCAL_LLM_BACKEND = savedBackend;
    if (savedBaseUrl === undefined) delete process.env.LOCAL_LLM_BASE_URL;
    else process.env.LOCAL_LLM_BASE_URL = savedBaseUrl;
    if (savedModelExtractor === undefined) delete process.env.LOCAL_LLM_MODEL_EXTRACTOR;
    else process.env.LOCAL_LLM_MODEL_EXTRACTOR = savedModelExtractor;
  });

  it('--local-grammar gbnf emits one warning naming the extractor on stderr', async () => {
    const { exit, io } = await captureStdio(() =>
      handleCompile([
        'add a thing',
        '--repo-root', fixtureRoot,
        '--no-editor',
        '--yes',
        '--extractor', 'local',
        '--local-grammar', 'gbnf',
      ]),
    );
    // Factory throws because no backend/base-url. The warning has fired
    // before the throw.
    assert.equal(exit, 3);
    const matches = io.stderr.match(/^warning: --local-grammar=gbnf/gm) ?? [];
    assert.equal(matches.length, 1, `expected exactly one grammar warning, got: ${io.stderr}`);
    assert.match(io.stderr, /does not apply to the extractor/);
    assert.match(io.stderr, /Session will use 'gbnf' as requested\./);
    assert.equal(io.stdout.indexOf('warning: --local-grammar'), -1, 'warning must not land on stdout');
  });

  it('--local-grammar json-schema emits no grammar warning', async () => {
    const { exit, io } = await captureStdio(() =>
      handleCompile([
        'add a thing',
        '--repo-root', fixtureRoot,
        '--no-editor',
        '--yes',
        '--extractor', 'local',
        '--local-grammar', 'json-schema',
      ]),
    );
    assert.equal(exit, 3);
    assert.equal(io.stderr.indexOf('warning: --local-grammar'), -1, `unexpected warning: ${io.stderr}`);
  });

  it('--extractor deterministic with --local-grammar gbnf emits no warning (extractor is not active)', async () => {
    // When the user asks for the deterministic extractor, the grammar
    // value isn't consumed by the extractor consumer at all. Warning
    // would be misleading. We pass `--contract-file <missing>` to make
    // the run fail fast on the deterministic path.
    const { io } = await captureStdio(() =>
      handleCompile([
        'add a thing',
        '--repo-root', fixtureRoot,
        '--no-editor',
        '--yes',
        '--local-grammar', 'gbnf',
      ]),
    );
    assert.equal(io.stderr.indexOf('warning: --local-grammar'), -1, `unexpected warning: ${io.stderr}`);
  });
});
