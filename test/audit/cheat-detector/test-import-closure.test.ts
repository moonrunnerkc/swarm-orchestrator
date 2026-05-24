import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { reachableSourceFiles } from '../../../src/audit/cheat-detector/test-import-closure';

function tempRepo(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-closure-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe('cheat-detector / test-import-closure', () => {
  it('resolves relative TS imports with extension probing', () => {
    const repo = tempRepo({
      'src/a.ts': "export const A = 1;\n",
      'src/b.ts': "import { A } from './a';\nexport const B = A + 1;\n",
      'test/b.test.ts': "import { B } from '../src/b';\ndescribe('B', () => {});\n",
    });
    const entry = path.join(repo, 'test/b.test.ts');
    const result = reachableSourceFiles([entry], repo);
    assert.ok(result.reachable.has(path.join(repo, 'src/b.ts')));
    assert.ok(result.reachable.has(path.join(repo, 'src/a.ts')));
    assert.equal(result.capped, false);
  });

  it('resolves index.* fallback for directory imports', () => {
    const repo = tempRepo({
      'src/widgets/index.ts': "export const W = 1;\n",
      'test/widgets.test.ts':
        "import { W } from '../src/widgets';\ndescribe('w', () => {});\n",
    });
    const entry = path.join(repo, 'test/widgets.test.ts');
    const result = reachableSourceFiles([entry], repo);
    assert.ok(result.reachable.has(path.join(repo, 'src/widgets/index.ts')));
  });

  it('honors tsconfig.json compilerOptions.paths', () => {
    const repo = tempRepo({
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@app/*': ['src/*'] },
        },
      }),
      'src/lib/core.ts': "export const C = 1;\n",
      'test/core.test.ts':
        "import { C } from '@app/lib/core';\ndescribe('c', () => {});\n",
    });
    const entry = path.join(repo, 'test/core.test.ts');
    const result = reachableSourceFiles([entry], repo);
    assert.ok(
      result.reachable.has(path.join(repo, 'src/lib/core.ts')),
      `expected src/lib/core.ts in closure; got ${Array.from(result.reachable).join(', ')}`,
    );
  });

  it('hits the maxNodes cap and reports capped:true', () => {
    // Build a chain: src/0 -> src/1 -> ... -> src/N
    const files: Record<string, string> = {};
    const N = 10;
    for (let i = 0; i < N; i++) {
      if (i < N - 1) {
        files[`src/m${i}.ts`] = `import './m${i + 1}';\nexport const X${i} = ${i};\n`;
      } else {
        files[`src/m${i}.ts`] = `export const X${i} = ${i};\n`;
      }
    }
    files['test/chain.test.ts'] = "import '../src/m0';\ndescribe('chain', () => {});\n";
    const repo = tempRepo(files);
    const entry = path.join(repo, 'test/chain.test.ts');
    // maxNodes=3 caps after 3 reached files (entry + 2 source files).
    const result = reachableSourceFiles([entry], repo, { maxNodes: 3 });
    assert.equal(result.capped, true);
    assert.ok(result.reachable.size <= 3);
  });

  it('reports unresolvedSpecCount when bare specs cannot be followed', () => {
    const repo = tempRepo({
      'test/bare.test.ts':
        "import { something } from 'some-bare-package';\nimport './nonexistent-relative';\ndescribe('x', () => {});\n",
    });
    const entry = path.join(repo, 'test/bare.test.ts');
    const result = reachableSourceFiles([entry], repo);
    assert.ok(
      result.unresolvedSpecCount >= 2,
      `expected at least 2 unresolved specs; got ${result.unresolvedSpecCount}`,
    );
  });

  it('produces deterministic results on the same fixture', () => {
    const repo = tempRepo({
      'src/a.ts': "export const A = 1;\n",
      'src/b.ts': "import './a';\nexport const B = 2;\n",
      'test/b.test.ts': "import '../src/b';\ndescribe('b', () => {});\n",
    });
    const entry = path.join(repo, 'test/b.test.ts');
    const r1 = reachableSourceFiles([entry], repo);
    const r2 = reachableSourceFiles([entry], repo);
    const a1 = Array.from(r1.reachable).sort();
    const a2 = Array.from(r2.reachable).sort();
    assert.deepEqual(a1, a2);
    assert.equal(r1.capped, r2.capped);
    assert.equal(r1.unresolvedSpecCount, r2.unresolvedSpecCount);
  });

  it('throws SwarmError when repoRoot does not exist', () => {
    assert.throws(
      () => reachableSourceFiles([], '/nonexistent/path/that/cannot/be/there'),
      /repoRoot does not exist/,
    );
  });
});
