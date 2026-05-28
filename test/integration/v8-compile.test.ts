import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { StubExtractor } from '../../src/contract/extractor/stub-extractor';
import { readContract } from '../../src/contract/serializer';

const fixtureRoot = path.resolve(__dirname, '..', '..', '..', 'fixtures', 'v8-empty');

function tmpOut(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-compile-int-'));
}

describe('integration: swarm v8 compile', () => {
  const stub = (): StubExtractor => StubExtractor.fromHeuristic();

  it('writes a contract to --out using the stub extractor', async () => {
    const out = tmpOut();
    try {
      const exit = await handleCompile(
        [
          'add a health check endpoint',
          '--repo-root', fixtureRoot,
          '--out', out,
          '--yes',
          '--no-editor',
        ],
        { extractor: stub() },
      );
      assert.equal(exit, 0);
      const contract = readContract(out);
      assert.equal(contract.manifest.goal, 'add a health check endpoint');
      assert.equal(contract.manifest.schemaVersion, 'v1');
      const types = contract.obligations.map((o) => o.type);
      assert.ok(types.includes('file-must-exist'));
      assert.ok(types.includes('build-must-pass'));
      assert.ok(types.includes('test-must-pass'));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('two compiles of the same goal produce the same contract hash', async () => {
    const a = tmpOut();
    const b = tmpOut();
    try {
      const args = (out: string): string[] => [
        'add a health check endpoint',
        '--repo-root', fixtureRoot,
        '--out', out,
        '--yes',
        '--no-editor',
      ];
      assert.equal(await handleCompile(args(a), { extractor: stub() }), 0);
      assert.equal(await handleCompile(args(b), { extractor: stub() }), 0);
      const ca = readContract(a);
      const cb = readContract(b);
      assert.equal(ca.manifest.contractHash, cb.manifest.contractHash);
      assert.equal(ca.manifest.contractId, cb.manifest.contractId);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  it('emits a non-empty contract.jsonl with one obligation per line', async () => {
    const out = tmpOut();
    try {
      const exit = await handleCompile(
        [
          'add a thing',
          '--repo-root', fixtureRoot,
          '--out', out,
          '--yes',
          '--no-editor',
        ],
        { extractor: stub() },
      );
      assert.equal(exit, 0);
      const jsonl = fs.readFileSync(path.join(out, 'contract.jsonl'), 'utf8');
      const lines = jsonl.split('\n').filter((l) => l.length > 0);
      assert.ok(lines.length >= 3, `expected ≥3 obligation lines, got ${lines.length}`);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.ok(['file-must-exist', 'build-must-pass', 'test-must-pass'].includes(parsed.type));
      }
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('rejects an unknown flag with a parse error and exit 1', async () => {
    const out = tmpOut();
    try {
      const exit = await handleCompile(
        [
          'add a thing',
          '--repo-root', fixtureRoot,
          '--out', out,
          '--yes',
          '--no-editor',
          '--bogus',
        ],
        { extractor: stub() },
      );
      assert.equal(exit, 1);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('uses an injected extractor when provided', async () => {
    const out = tmpOut();
    try {
      const extractor = StubExtractor.fromObligations([
        { type: 'file-must-exist', path: 'src/custom-injected.ts' },
        { type: 'build-must-pass', command: 'npm run build' },
        { type: 'test-must-pass', command: 'npm test' },
      ]);
      const exit = await handleCompile(
        [
          'inject me',
          '--repo-root', fixtureRoot,
          '--out', out,
          '--yes',
          '--no-editor',
        ],
        { extractor },
      );
      assert.equal(exit, 0);
      const contract = readContract(out);
      assert.ok(
        contract.obligations.some(
          (o) => o.type === 'file-must-exist' && o.path === 'src/custom-injected.ts',
        ),
      );
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('auto-discovers contract.yaml when the deterministic extractor has no input flag', async () => {
    // Mirrors the `swarm init` + `swarm compile <goal>` flow documented
    // in the README: contract.yaml in cwd should be picked up without an
    // explicit --contract-file.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-compile-autodisc-'));
    const out = tmpOut();
    try {
      fs.writeFileSync(
        path.join(repo, 'contract.yaml'),
        [
          'obligations:',
          '  - type: build-must-pass',
          '    command: npm run build',
          '  - type: test-must-pass',
          '    command: npm test',
          '',
        ].join('\n'),
        'utf8',
      );
      const exit = await handleCompile([
        'ensure tests pass',
        '--repo-root', repo,
        '--out', out,
        '--yes',
        '--no-editor',
      ]);
      assert.equal(exit, 0);
      const contract = readContract(out);
      assert.ok(contract.obligations.some((o) => o.type === 'build-must-pass'));
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('--help exits 0 without re-printing usage from the catch block', async () => {
    // Earlier, parseCompileFlags threw `'help requested'` after printing
    // usage; the handler caught it, logged the message, and printed usage
    // a second time. Now --help is a normal flag short-circuit.
    const exit = await handleCompile(['--help']);
    assert.equal(exit, 0);
  });
});
