#!/usr/bin/env node
// Phase 2c parity check: run each extractor against a fixed fixture corpus
// and dump the resulting ContractEnvelope (or structured error) to
// evidence/phase-2-parity/extractors/<extractor>/<case>.json. Anthropic is
// included as a control: its tool-use loop is unchanged by 2c, so its
// captures must remain stable.
//
// Pre-cut: run this to capture baseline. Post-cut: re-run and `diff -r`
// against the committed captures. Byte-identical is the halt condition.

const fs = require('fs');
const path = require('path');

const {
  DeterministicExtractor,
  DeterministicExtractorError,
} = require('../dist/src/contract/extractor/deterministic-extractor');
const { LocalExtractor } = require('../dist/src/contract/extractor/local-extractor');
const { StubExtractor } = require('../dist/src/contract/extractor/stub-extractor');
const { AnthropicExtractor } = require('../dist/src/contract/extractor/anthropic-extractor');

const OUT_ROOT = path.join(__dirname, '..', 'evidence', 'phase-2-parity', 'extractors');

const REPO_CTX = {
  repoRoot: '/tmp/no-such-repo',
  buildCommand: null,
  testCommand: null,
  language: 'unknown',
};

const REPO_CTX_FULL = {
  repoRoot: '/tmp/example',
  buildCommand: 'npm run build',
  testCommand: 'npm test',
  language: 'typescript',
};

function serializeResult(result) {
  return JSON.stringify(result, null, 2) + '\n';
}

function serializeError(err) {
  const out = {
    error: true,
    name: err.name,
    message: err.message,
  };
  if (err instanceof DeterministicExtractorError) {
    out.issues = err.issues;
  }
  return JSON.stringify(out, null, 2) + '\n';
}

async function runCase(dir, name, fn) {
  fs.mkdirSync(dir, { recursive: true });
  try {
    const result = await fn();
    fs.writeFileSync(path.join(dir, `${name}.json`), serializeResult(result));
  } catch (err) {
    fs.writeFileSync(path.join(dir, `${name}.json`), serializeError(err));
  }
}

async function runDeterministic() {
  const dir = path.join(OUT_ROOT, 'deterministic');
  const validCases = [
    { name: 'file-must-exist', obligations: [{ type: 'file-must-exist', path: 'src/lib/x.ts' }] },
    {
      name: 'build-must-pass',
      obligations: [
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'function-must-have-signature',
      obligations: [
        {
          type: 'function-must-have-signature',
          file: 'src/handler.ts',
          name: 'handle',
          signature: '(req: Request, res: Response): Promise<void>',
        },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'property-must-hold',
      obligations: [
        { type: 'property-must-hold', predicate: 'grep -q TODO src/', target: 'no TODO markers' },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'import-graph-must-satisfy',
      obligations: [
        { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'coverage-must-exceed',
      obligations: [
        {
          type: 'coverage-must-exceed',
          scope: 'coverage/coverage-summary.json',
          metric: 'lines',
          threshold: 80,
        },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'performance-must-not-regress',
      obligations: [
        {
          type: 'performance-must-not-regress',
          benchmark: 'node bench.js',
          baseline: 'bench/baseline.json',
          threshold: 0.1,
        },
        { type: 'test-must-pass', command: 'npm test' },
      ],
    },
    {
      name: 'mixed-all-eight',
      obligations: [
        { type: 'file-must-exist', path: 'src/x.ts' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
        {
          type: 'function-must-have-signature',
          file: 'src/x.ts',
          name: 'f',
          signature: '(a, b)',
        },
        { type: 'property-must-hold', predicate: 'true', target: 'always' },
        { type: 'import-graph-must-satisfy', constraint: 'no-upward-imports', scope: 'src' },
        {
          type: 'coverage-must-exceed',
          scope: 'coverage/coverage-summary.json',
          metric: 'branches',
          threshold: 75,
        },
        {
          type: 'performance-must-not-regress',
          benchmark: 'bench',
          baseline: 'bench.json',
          threshold: 0.05,
        },
      ],
    },
  ];
  for (const c of validCases) {
    await runCase(dir, `valid-${c.name}`, () =>
      DeterministicExtractor.fromInline({ obligations: c.obligations }).extract({
        goal: 'unused',
        repoContext: REPO_CTX,
      }),
    );
  }
  const invalidCases = [
    { name: 'missing-obligations', envelope: {} },
    { name: 'empty-obligations', envelope: { obligations: [] } },
    {
      name: 'unknown-field',
      envelope: {
        obligations: [{ type: 'file-must-exist', path: 'a.ts', description: 'nope' }],
      },
    },
    {
      name: 'wrong-path-type',
      envelope: { obligations: [{ type: 'file-must-exist', path: 42 }] },
    },
    {
      name: 'empty-command',
      envelope: { obligations: [{ type: 'test-must-pass', command: '' }] },
    },
    {
      name: 'bad-enum',
      envelope: {
        obligations: [
          { type: 'import-graph-must-satisfy', constraint: 'no-side-imports', scope: 'src' },
        ],
      },
    },
    {
      name: 'coverage-over-max',
      envelope: {
        obligations: [
          {
            type: 'coverage-must-exceed',
            scope: 'coverage/coverage-summary.json',
            metric: 'lines',
            threshold: 150,
          },
        ],
      },
    },
    {
      name: 'unknown-type',
      envelope: { obligations: [{ type: 'file-must-not-exist', path: 'a.ts' }] },
    },
  ];
  for (const c of invalidCases) {
    await runCase(dir, `invalid-${c.name}`, () =>
      new DeterministicExtractor({
        source: { kind: 'inline', envelope: c.envelope },
      }).extract({ goal: 'unused', repoContext: REPO_CTX }),
    );
  }
}

class FakeLocalBackend {
  constructor(responseText, grammars = ['json-schema', 'none']) {
    this.name = 'fake';
    this.responseText = responseText;
    this.grammars = grammars;
  }
  supportsGrammar() {
    return this.grammars;
  }
  async chat(_req) {
    return {
      text: this.responseText,
      usage: { inputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, outputTokens: 1 },
      usageEstimated: false,
    };
  }
  async stream() {
    throw new Error('not used');
  }
}

async function runLocal() {
  const dir = path.join(OUT_ROOT, 'local');
  const jsonResp = JSON.stringify({
    obligations: [{ type: 'test-must-pass', command: 'npm test' }],
  });
  const cases = [
    {
      name: 'plain-json',
      build: () =>
        new LocalExtractor({ backend: new FakeLocalBackend(jsonResp), model: 'm0' }),
    },
    {
      name: 'fenced-json',
      build: () =>
        new LocalExtractor({
          backend: new FakeLocalBackend('```json\n' + jsonResp + '\n```'),
          model: 'm0',
        }),
    },
    {
      name: 'no-json-schema-grammar',
      build: () =>
        new LocalExtractor({
          backend: new FakeLocalBackend(jsonResp, ['gbnf']),
          model: 'm0',
        }),
    },
    {
      name: 'invalid-json',
      build: () =>
        new LocalExtractor({
          backend: new FakeLocalBackend('Here is your contract...'),
          model: 'm0',
        }),
    },
    {
      name: 'json-missing-obligations',
      build: () =>
        new LocalExtractor({
          backend: new FakeLocalBackend(JSON.stringify({ data: [] })),
          model: 'm0',
        }),
    },
    {
      name: 'multi-obligation',
      build: () =>
        new LocalExtractor({
          backend: new FakeLocalBackend(
            JSON.stringify({
              obligations: [
                { type: 'file-must-exist', path: 'src/x.ts' },
                { type: 'build-must-pass', command: 'npm run build' },
                { type: 'test-must-pass', command: 'npm test' },
              ],
            }),
          ),
          model: 'm0',
        }),
    },
  ];
  for (const c of cases) {
    await runCase(dir, c.name, () =>
      c.build().extract({ goal: 'g', repoContext: REPO_CTX }),
    );
  }
}

async function runStub() {
  const dir = path.join(OUT_ROOT, 'stub');
  const cases = [
    {
      name: 'fromHeuristic-with-path',
      run: () =>
        StubExtractor.fromHeuristic().extract({
          goal: 'create src/lib/parser.ts to parse input',
          repoContext: REPO_CTX,
        }),
    },
    {
      name: 'fromHeuristic-no-path',
      run: () =>
        StubExtractor.fromHeuristic().extract({
          goal: 'fix the bug',
          repoContext: REPO_CTX,
        }),
    },
    {
      name: 'fromHeuristic-with-build',
      run: () =>
        StubExtractor.fromHeuristic().extract({
          goal: 'add a util.ts',
          repoContext: { ...REPO_CTX, buildCommand: 'make build', testCommand: 'make test' },
        }),
    },
    {
      name: 'fromObligations',
      run: () =>
        StubExtractor.fromObligations([
          { type: 'file-must-exist', path: 'src/a.ts' },
          { type: 'test-must-pass', command: 'npm test' },
        ]).extract({ goal: 'anything', repoContext: REPO_CTX }),
    },
    {
      name: 'fromGoalMap-hit',
      run: () =>
        StubExtractor.fromGoalMap({
          known: [{ type: 'test-must-pass', command: 'pytest' }],
        }).extract({ goal: 'known', repoContext: REPO_CTX }),
    },
    {
      name: 'fromGoalMap-miss-heuristic',
      run: () =>
        StubExtractor.fromGoalMap({
          other: [{ type: 'test-must-pass', command: 'pytest' }],
        }).extract({ goal: 'create src/lib/x.ts', repoContext: REPO_CTX }),
    },
  ];
  for (const c of cases) {
    await runCase(dir, c.name, c.run);
  }
}

function fakeAnthropicClient(toolUse) {
  return {
    messages: {
      create: async () => ({ content: [toolUse] }),
    },
  };
}

async function runAnthropic() {
  const dir = path.join(OUT_ROOT, 'anthropic');
  const all8 = [
    { type: 'file-must-exist', path: 'src/handler.ts' },
    { type: 'build-must-pass', command: 'npm run build' },
    { type: 'test-must-pass', command: 'npm test' },
    {
      type: 'function-must-have-signature',
      file: 'src/handler.ts',
      name: 'handler',
      signature: '(req: Request): Promise<Response>',
    },
    {
      type: 'property-must-hold',
      predicate: '! grep -r "eval(" src',
      target: 'no eval() calls in src',
    },
    { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
    {
      type: 'coverage-must-exceed',
      scope: 'coverage/coverage-summary.json',
      metric: 'lines',
      threshold: 90,
    },
    {
      type: 'performance-must-not-regress',
      benchmark: 'node bench.js',
      baseline: 'bench/baseline.json',
      threshold: 0.1,
    },
  ];
  const cases = [
    {
      name: 'all-eight-types',
      toolUse: {
        type: 'tool_use',
        name: 'submit_contract',
        input: { obligations: all8 },
      },
    },
    {
      name: 'single-test-must-pass',
      toolUse: {
        type: 'tool_use',
        name: 'submit_contract',
        input: { obligations: [{ type: 'test-must-pass', command: 'npm test' }] },
      },
    },
    {
      name: 'json-encoded-obligations',
      toolUse: {
        type: 'tool_use',
        name: 'submit_contract',
        input: { obligations: JSON.stringify(all8) },
      },
    },
  ];
  for (const c of cases) {
    await runCase(dir, c.name, () =>
      new AnthropicExtractor({ client: fakeAnthropicClient(c.toolUse) }).extract({
        goal: 'g',
        repoContext: REPO_CTX_FULL,
      }),
    );
  }
}

async function main() {
  fs.rmSync(OUT_ROOT, { recursive: true, force: true });
  await runDeterministic();
  await runLocal();
  await runStub();
  await runAnthropic();
  const counts = ['deterministic', 'local', 'stub', 'anthropic'].map((n) => {
    const files = fs.readdirSync(path.join(OUT_ROOT, n));
    return `${n}=${files.length}`;
  });
  process.stdout.write(`wrote captures: ${counts.join(' ')}\n`);
}

main().catch((err) => {
  process.stderr.write(`harness failure: ${err.stack ?? err.message}\n`);
  process.exit(1);
});
