import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  extractRenamePairs,
  resolveOldSymbol,
  scanCheckoutForOldSymbol,
  buildGrepReproduceCommand,
  enumerateRepoSourceFiles,
  runFakeRefactorRestoration,
  type RenamePair,
} from '../../../src/audit/execution-grounded/fake-refactor-restoration';

// Diff that renames `oldTotal` -> `computeTotal` in src/calc.ts.
const RENAME_DIFF = `diff --git a/src/calc.ts b/src/calc.ts
index 1111111..2222222 100644
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,3 +1,3 @@
-export function oldTotal(a: number, b: number): number {
+export function computeTotal(a: number, b: number): number {
   return a + b;
 }
`;

describe('extractRenamePairs (pure)', () => {
  it('pairs the deleted export with the same-hunk added export', () => {
    const pairs = extractRenamePairs(RENAME_DIFF, 'src/calc.ts');
    assert.equal(pairs.length, 1);
    assert.equal(pairs[0]!.oldName, 'oldTotal');
    assert.equal(pairs[0]!.newName, 'computeTotal');
  });

  it('returns [] when the file is not in the diff', () => {
    assert.deepEqual(extractRenamePairs(RENAME_DIFF, 'src/other.ts'), []);
  });

  it('returns [] when there is no rename (no export decl pair)', () => {
    const noRename = `diff --git a/src/calc.ts b/src/calc.ts
--- a/src/calc.ts
+++ b/src/calc.ts
@@ -1,1 +1,1 @@
-  return a + b;
+  return a + b + 1;
`;
    assert.deepEqual(extractRenamePairs(noRename, 'src/calc.ts'), []);
  });
});

describe('resolveOldSymbol (pure)', () => {
  const pairs: RenamePair[] = [
    { oldName: 'oldTotal', newName: 'computeTotal', addedLine: 1 },
    { oldName: 'oldSum', newName: 'computeSum', addedLine: 10 },
  ];

  it('localizes to the pair on the finding line', () => {
    assert.equal(resolveOldSymbol(pairs, 10)!.oldName, 'oldSum');
  });

  it('returns null when the line does not disambiguate two distinct old names', () => {
    assert.equal(resolveOldSymbol(pairs, 999), null);
  });

  it('resolves when there is a single pair regardless of line', () => {
    assert.equal(resolveOldSymbol([pairs[0]!], 999)!.oldName, 'oldTotal');
  });
});

describe('scanCheckoutForOldSymbol (fs, temp dir)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakeref-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('finds a surviving reference and reports the declaration gone', () => {
    // The rename declared computeTotal but a caller still names oldTotal.
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'report.ts'),
      "import { oldTotal } from './calc';\nexport const r = oldTotal(1, 2);\n",
    );
    const scan = scanCheckoutForOldSymbol(root, 'oldTotal');
    assert.equal(scan.declared, false);
    assert.equal(scan.capped, false);
    assert.ok(scan.references.some((r) => r.startsWith('src/report.ts:')));
  });

  it('reports the declaration still present when another file declares the old name', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'legacy.ts'), 'export function oldTotal() {\n  return 0;\n}\n');
    const scan = scanCheckoutForOldSymbol(root, 'oldTotal');
    assert.equal(scan.declared, true);
  });

  it('does not count a `.oldTotal` member access as a reference', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(): number {\n  return 0;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'use.ts'), 'export const x = api.oldTotal;\n');
    const scan = scanCheckoutForOldSymbol(root, 'oldTotal');
    assert.deepEqual(scan.references, []);
  });

  it('finds no reference when the rename is complete', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(): number {\n  return 0;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'use.ts'), 'import { computeTotal } from "./calc";\nexport const x = computeTotal();\n');
    const scan = scanCheckoutForOldSymbol(root, 'oldTotal');
    assert.deepEqual(scan.references, []);
    assert.equal(scan.declared, false);
  });
});

describe('runFakeRefactorRestoration (full orchestrator, fs)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakeref-run-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function run() {
    return runFakeRefactorRestoration({
      finding: { category: 'fake-refactor', file: 'src/calc.ts', line: 1 },
      prDiff: RENAME_DIFF,
      prRef: 'acme/calc#1',
      prHeadSha: 'abc1234',
      repoRoot: root,
    });
  }

  it('proves a fake refactor: old name gone but still referenced', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'report.ts'), "import { oldTotal } from './calc';\nexport const r = oldTotal(1, 2);\n");
    const record = run();
    assert.equal(record.verdict, 'proven', record.reason ?? '');
    assert.equal(record.controls.oldSymbolResolved, true);
    assert.equal(record.controls.oldSymbolDeclarationRemoved, true);
    assert.equal(record.controls.oldSymbolStillReferenced, true);
    assert.equal(record.oldName, 'oldTotal');
    assert.equal(record.newName, 'computeTotal');
    assert.ok(record.references.length > 0);
    assert.match(record.reproduceCommand, /grep -rnw 'oldTotal'/);
  });

  it('refutes a complete rename: no surviving reference', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(a: number, b: number): number {\n  return a + b;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'report.ts'), "import { computeTotal } from './calc';\nexport const r = computeTotal(1, 2);\n");
    const record = run();
    assert.equal(record.verdict, 'refuted', record.reason ?? '');
    assert.equal(record.controls.oldSymbolStillReferenced, false);
  });

  it('fails closed when the old symbol is still declared elsewhere', () => {
    fs.writeFileSync(
      path.join(root, 'src', 'calc.ts'),
      'export function computeTotal(): number {\n  return 0;\n}\n',
    );
    fs.writeFileSync(path.join(root, 'src', 'legacy.ts'), 'export function oldTotal() {\n  return 0;\n}\nexport const r = oldTotal();\n');
    const record = run();
    assert.equal(record.verdict, 'not-proven:old-symbol-still-declared');
    assert.equal(record.controls.oldSymbolDeclarationRemoved, false);
  });

  it('fails closed on a non-source finding file', () => {
    const record = runFakeRefactorRestoration({
      finding: { category: 'fake-refactor', file: 'README.md', line: 1 },
      prDiff: RENAME_DIFF,
      prRef: 'acme/calc#1',
      prHeadSha: 'abc1234',
      repoRoot: root,
    });
    assert.equal(record.verdict, 'not-proven:non-source-file');
  });
});

describe('buildGrepReproduceCommand (pure, fail-closed)', () => {
  it('renders a fetch/checkout/grep command', () => {
    const cmd = buildGrepReproduceCommand({
      prRef: 'acme/calc#1',
      prHeadSha: 'abc1234',
      oldName: 'oldTotal',
      referenceFiles: ['src/report.ts'],
    });
    assert.match(cmd, /git fetch origin pull\/1\/head/);
    assert.match(cmd, /git checkout abc1234/);
    assert.match(cmd, /grep -rnw 'oldTotal' src\/report\.ts/);
  });

  it('throws on an unsafe symbol (fail closed)', () => {
    assert.throws(() =>
      buildGrepReproduceCommand({
        prRef: 'acme/calc#1',
        prHeadSha: 'abc1234',
        oldName: 'x; rm -rf /',
        referenceFiles: ['src/report.ts'],
      }),
    );
  });

  it('throws on a traversal reference path (fail closed)', () => {
    assert.throws(() =>
      buildGrepReproduceCommand({
        prRef: 'acme/calc#1',
        prHeadSha: 'abc1234',
        oldName: 'oldTotal',
        referenceFiles: ['../../etc/passwd'],
      }),
    );
  });
});

describe('enumerateRepoSourceFiles (fs)', () => {
  it('skips node_modules and respects the cap', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-fakeref-enum-'));
    try {
      fs.mkdirSync(path.join(root, 'src'));
      fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(root, 'src', 'a.ts'), '');
      fs.writeFileSync(path.join(root, 'src', 'b.tsx'), '');
      fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), '');
      const files = enumerateRepoSourceFiles(root, 100);
      assert.equal(files.length, 2);
      assert.ok(files.every((f) => !f.includes('node_modules')));
      assert.equal(enumerateRepoSourceFiles(root, 1).length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
