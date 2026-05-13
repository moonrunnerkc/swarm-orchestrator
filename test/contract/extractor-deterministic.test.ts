import { strict as assert } from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DeterministicExtractor,
  DeterministicExtractorError,
} from '../../src/contract/extractor/deterministic-extractor';
import { type ObligationV1, type RepoContext } from '../../src/contract/types';

const REPO_CTX: RepoContext = {
  repoRoot: '/tmp/no-such-repo',
  buildCommand: null,
  testCommand: null,
  language: 'unknown',
};

const VALID_FIXTURES: Array<{ name: string; obligations: ObligationV1[] }> = [
  {
    name: 'file-must-exist (single)',
    obligations: [{ type: 'file-must-exist', path: 'src/lib/x.ts' }],
  },
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
      {
        type: 'property-must-hold',
        predicate: 'grep -q TODO src/',
        target: 'no TODO markers',
      },
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
    name: 'mixed: every obligation type at once',
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

interface InvalidFixture {
  name: string;
  envelope: unknown;
  expectRuleSubstring: string;
}

const INVALID_FIXTURES: InvalidFixture[] = [
  {
    name: 'missing top-level obligations array',
    envelope: {},
    expectRuleSubstring: 'obligations',
  },
  {
    name: 'empty obligations array',
    envelope: { obligations: [] },
    expectRuleSubstring: 'at least one',
  },
  {
    name: 'unknown field on obligation',
    envelope: {
      obligations: [
        { type: 'file-must-exist', path: 'a.ts', description: 'not allowed' },
      ],
    },
    expectRuleSubstring: 'description',
  },
  {
    name: 'wrong type in path',
    envelope: { obligations: [{ type: 'file-must-exist', path: 42 }] },
    expectRuleSubstring: 'type',
  },
  {
    name: 'empty string in command',
    envelope: { obligations: [{ type: 'test-must-pass', command: '' }] },
    expectRuleSubstring: 'non-empty',
  },
  {
    name: 'invalid enum value for import constraint',
    envelope: {
      obligations: [
        { type: 'import-graph-must-satisfy', constraint: 'no-side-imports', scope: 'src' },
      ],
    },
    expectRuleSubstring: 'must be one of',
  },
  {
    name: 'coverage threshold above maximum',
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
    expectRuleSubstring: 'numeric range',
  },
  {
    name: 'unknown obligation type',
    envelope: {
      obligations: [{ type: 'file-must-not-exist', path: 'a.ts' }],
    },
    expectRuleSubstring: 'eight allowed obligation types',
  },
];

describe('contract/extractor — DeterministicExtractor', () => {
  describe('valid fixtures', () => {
    for (const fixture of VALID_FIXTURES) {
      it(`accepts: ${fixture.name}`, async () => {
        const extractor = DeterministicExtractor.fromInline({ obligations: fixture.obligations });
        const out = await extractor.extract({ goal: 'unused', repoContext: REPO_CTX });
        assert.deepEqual(out.obligations, fixture.obligations);
        assert.equal(out.provenance.name, 'deterministic');
        assert.equal(out.provenance.model, null);
        assert.equal(out.provenance.temperature, null);
        assert.equal(typeof out.provenance.promptSha256, 'string');
        assert.equal(out.provenance.promptSha256?.length, 64);
      });
    }
  });

  describe('invalid fixtures', () => {
    for (const fixture of INVALID_FIXTURES) {
      it(`rejects: ${fixture.name}`, async () => {
        const extractor = new DeterministicExtractor({
          source: { kind: 'inline', envelope: fixture.envelope as never },
        });
        await assert.rejects(
          () => extractor.extract({ goal: 'unused', repoContext: REPO_CTX }),
          (err: unknown) => {
            assert.ok(err instanceof DeterministicExtractorError, `expected DeterministicExtractorError, got ${(err as Error).name}`);
            const text = `${err.message}\n${err.issues.map((i) => `${i.fix} ${i.message}`).join('\n')}`;
            assert.ok(
              text.toLowerCase().includes(fixture.expectRuleSubstring.toLowerCase()),
              `expected error text to contain "${fixture.expectRuleSubstring}"; got:\n${text}`,
            );
            return true;
          },
        );
      });
    }
  });

  describe('file input form', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-extractor-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads a JSON contract file', async () => {
      const file = path.join(tmpDir, 'contract.json');
      fs.writeFileSync(
        file,
        JSON.stringify({ obligations: [{ type: 'test-must-pass', command: 'npm test' }] }),
      );
      const extractor = DeterministicExtractor.fromFile(file);
      const out = await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
      assert.equal(out.obligations.length, 1);
      assert.equal(out.obligations[0]!.type, 'test-must-pass');
    });

    it('loads a YAML contract file', async () => {
      const file = path.join(tmpDir, 'contract.yaml');
      fs.writeFileSync(file, 'obligations:\n  - type: test-must-pass\n    command: npm test\n');
      const extractor = DeterministicExtractor.fromFile(file);
      const out = await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
      assert.equal(out.obligations.length, 1);
      assert.equal(out.obligations[0]!.type, 'test-must-pass');
    });

    it('rejects an unknown extension', async () => {
      const file = path.join(tmpDir, 'contract.toml');
      fs.writeFileSync(file, 'whatever');
      const extractor = DeterministicExtractor.fromFile(file);
      await assert.rejects(
        () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
        /unsupported extension/,
      );
    });

    it('rejects a missing file', async () => {
      const extractor = DeterministicExtractor.fromFile(path.join(tmpDir, 'does-not-exist.json'));
      await assert.rejects(
        () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
        /not found/,
      );
    });

    it('rejects malformed JSON', async () => {
      const file = path.join(tmpDir, 'contract.json');
      fs.writeFileSync(file, '{ this is not json');
      const extractor = DeterministicExtractor.fromFile(file);
      await assert.rejects(
        () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
        /not valid JSON/,
      );
    });
  });

  describe('module input form', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'det-extractor-mod-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('loads a JS module default export', async () => {
      const file = path.join(tmpDir, 'contract.js');
      fs.writeFileSync(
        file,
        `module.exports = { obligations: [{ type: 'test-must-pass', command: 'npm test' }] };`,
      );
      const extractor = DeterministicExtractor.fromModule(file);
      const out = await extractor.extract({ goal: 'g', repoContext: REPO_CTX });
      assert.equal(out.obligations.length, 1);
    });

    it('rejects a missing module path', async () => {
      const extractor = DeterministicExtractor.fromModule(path.join(tmpDir, 'nope.js'));
      await assert.rejects(
        () => extractor.extract({ goal: 'g', repoContext: REPO_CTX }),
        /not found/,
      );
    });
  });

  describe('determinism', () => {
    it('produces identical promptSha256 across runs with the same input', async () => {
      const env = { obligations: [{ type: 'test-must-pass' as const, command: 'npm test' }] };
      const a = await DeterministicExtractor.fromInline(env).extract({
        goal: 'g',
        repoContext: REPO_CTX,
      });
      const b = await DeterministicExtractor.fromInline(env).extract({
        goal: 'g',
        repoContext: REPO_CTX,
      });
      assert.equal(a.provenance.promptSha256, b.provenance.promptSha256);
    });
  });
});
