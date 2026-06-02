import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupChangedLinesByPackage, rerootToRepo } from '../../../src/audit/execution-grounded/monorepo';
import type { ChangedLineRanges } from '../../../src/audit/cheat-detector/diff-walker';

function makeWorkspace(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'eg-mono-'));
  fs.writeFileSync(path.join(ws, 'package.json'), '{"name":"root"}');
  fs.mkdirSync(path.join(ws, 'packages', 'a', 'src'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'packages', 'b', 'src'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'packages', 'a', 'package.json'), '{"name":"a"}');
  fs.writeFileSync(path.join(ws, 'packages', 'b', 'package.json'), '{"name":"b"}');
  return ws;
}

describe('execution-grounded / monorepo package scoping', () => {
  it('groups changed lines by the nearest owning package and makes keys package-relative', () => {
    const ws = makeWorkspace();
    try {
      const changed: ChangedLineRanges = {
        'packages/a/src/x.ts': [{ start: 1, end: 3 }],
        'packages/a/src/y.ts': [{ start: 5, end: 5 }],
        'packages/b/src/z.ts': [{ start: 2, end: 2 }],
      };
      const scopes = groupChangedLinesByPackage(ws, changed).sort((p, q) => p.packageDir.localeCompare(q.packageDir));
      assert.equal(scopes.length, 2);
      assert.equal(scopes[0]!.packageDir, 'packages/a');
      assert.deepEqual(Object.keys(scopes[0]!.changedLines).sort(), ['src/x.ts', 'src/y.ts']);
      assert.deepEqual(scopes[0]!.changedLines['src/x.ts'], [{ start: 1, end: 3 }]);
      assert.equal(scopes[1]!.packageDir, 'packages/b');
      assert.deepEqual(Object.keys(scopes[1]!.changedLines), ['src/z.ts']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('falls back to the root package when a file has no nearer package.json', () => {
    const ws = makeWorkspace();
    try {
      const changed: ChangedLineRanges = { 'scripts/tool.ts': [{ start: 1, end: 1 }] };
      const scopes = groupChangedLinesByPackage(ws, changed);
      assert.equal(scopes.length, 1);
      assert.equal(scopes[0]!.packageDir, '');
      assert.deepEqual(Object.keys(scopes[0]!.changedLines), ['scripts/tool.ts']);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rerootToRepo rebuilds the workspace-relative path', () => {
    assert.equal(rerootToRepo('packages/a', 'src/x.ts'), 'packages/a/src/x.ts');
    assert.equal(rerootToRepo('', 'src/x.ts'), 'src/x.ts');
  });
});
